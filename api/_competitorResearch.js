// Grounds competitor intelligence in live web search results instead of letting
// the main strategy prompt name competitors from the model's own memory --
// for a small/unfamiliar business name (e.g. a specific local company rather
// than a well-known brand) the model has no real knowledge of who it competes
// with, and asking it to guess produces plausible-sounding but fabricated
// names. This searches the live web first and only returns competitors that
// come from an actual, independently-checked source URL.
import { generateOpenRouterWebSearch } from './_openrouter.js';
import { urlIsReachable } from './_webBusinessSearch.js';
import { facebookBusinessPageKey, socialPlatformFromUrl, validFacebookUrl, validLinkedInUrl, isSupportedPublicSocialUrl } from './_socialUrls.js';
import { fetchMetaAdLibraryActivity, isMetaAdLibraryConfigured } from './_metaAdLibrary.js';
import { fetchApifySocialActivity, isApifySocialActivityConfigured } from './_apifySocialActivity.js';

export { socialPlatformFromUrl };

const MAX_COMPETITOR_CANDIDATES = 75;
const URL_VERIFICATION_CONCURRENCY = 8;
const MAX_ACTIVITIES_PER_COMPETITOR = 14;
// The Facebook-only/TikTok-only profile+activity pass used to list every
// missing-platform competitor (up to 50) in one search call -- the same
// budget-dilution symptom the discovery stage had (see discoveryFocuses):
// with many businesses sharing one call, the search plugin's budget spreads
// too thin per business, and a real official Page/profile URL a business
// does have can go unfound. Batching into small groups run concurrently
// gives each business closer to its own dedicated search budget.
const SOCIAL_LOOKUP_BATCH_SIZE = 6;
const DISCOVERY_MAX_RESULTS = 30;
const DISCOVERY_MAX_TOKENS = 12000;
// A single non-agentic web-search call resolves its search queries once, from
// the prompt text, before the model has written a single competitor name --
// so it can never form a targeted "site:facebook.com <exact name>" query for a
// business it has not discovered yet. Folding discovery and activity lookup
// into one call was tried and measured live: it reliably finds competitor
// names but returns near-zero activity, because the search budget goes to
// generic category terms instead of per-company queries. Activity search only
// works once the exact names are already known, so it has to be a second,
// separate call that lists those exact names -- this is not a batching
// convenience, it is the only way the search plugin can target them.
const ACTIVITY_MAX_RESULTS = 60;
const ACTIVITY_MAX_TOKENS = 20000;
// The activity call lists every discovered name in one prompt instead of
// splitting into per-source or five-at-a-time batches -- far fewer calls than
// the old design, at the cost of the search budget being shared across more
// names in a single call. Capping the list keeps that per-name share workable.
// Competitor scans return every verified match requested by the API (currently
// capped at 50 for request-size safety), so activity research must cover that
// same full list instead of silently stopping after the first 20 companies.
const ACTIVITY_LOOKUP_LIST_CAP = 50;
// One retry only, and only when a call produced no usable structure at all
// (network/parse failure or a genuinely empty response) -- a call that
// legitimately found zero real competitors, or zero activity, is a valid
// result, not a failure, and is never retried.
const MAX_SEARCH_ATTEMPTS = 2;

const mapWithConcurrency = async (items, limit, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const jsonFromText = (text) => {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : text || '{}');
  } catch {
    return {};
  }
};

const competitorKey = (value) => String(value || '').trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const normalizedIdentityUrl = (value) => String(value || '').trim().replace(/\/$/, '').toLowerCase();
const businessWebsiteUrl = (value) => {
  const url = String(value || '').trim().slice(0, 300);
  return /^https?:\/\//i.test(url) && socialPlatformFromUrl(url) === 'Web' ? url : '';
};
const sharesPublicIdentity = (left, right) => {
  if (['facebookUrl', 'linkedinUrl', 'websiteUrl'].some((field) => (
    normalizedIdentityUrl(left[field]) && normalizedIdentityUrl(right[field])
    && normalizedIdentityUrl(left[field]) !== normalizedIdentityUrl(right[field])
  ))) return false;
  return ['sourceUrl', 'facebookUrl', 'linkedinUrl', 'websiteUrl'].some((field) => (
    normalizedIdentityUrl(left[field]) && normalizedIdentityUrl(left[field]) === normalizedIdentityUrl(right[field])
  ));
};

// A model can put another company's post under a familiar competitor name.
// When an official Page is known, require a matching Page slug in the post URL
// or an explicit matching publisher URL for opaque reel/feed URLs.
const socialEntityPath = (value, platform) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\.|^m\./g, '');
    const parts = url.pathname.split('/').filter(Boolean);
    if (platform === 'Facebook' && ['facebook.com', 'fb.com'].includes(host)) {
      if (!parts[0] || ['reel', 'watch', 'groups', 'events', 'photo.php', 'permalink.php', 'story.php'].includes(parts[0].toLowerCase())) return '';
      if (parts[0].toLowerCase() === 'pages') return parts[2] ? `pages/${parts[2].toLowerCase()}` : '';
      return parts[0].toLowerCase();
    }
    if (platform === 'LinkedIn' && (host === 'linkedin.com' || host.endsWith('.linkedin.com'))
      && ['company', 'school', 'showcase'].includes(parts[0]?.toLowerCase())) {
      return `${parts[0].toLowerCase()}/${(parts[1] || '').toLowerCase()}`;
    }
  } catch {
    return '';
  }
  return '';
};

const activityBelongsToCandidate = (candidate, sourceUrl, publisherPageUrl = '') => {
  const platform = socialPlatformFromUrl(sourceUrl);
  if (platform !== 'Facebook' && platform !== 'LinkedIn') return true;
  const officialUrl = platform === 'Facebook' ? candidate.facebookUrl : candidate.linkedinUrl;
  const officialPath = socialEntityPath(officialUrl, platform);
  const sourcePath = socialEntityPath(sourceUrl, platform);
  if (sourcePath && officialPath) return sourcePath === officialPath;
  if (sourcePath) return true;
  const publisherPath = socialEntityPath(publisherPageUrl, platform);
  return !!(officialPath && publisherPath && officialPath === publisherPath);
};

const sourceIdentifiesCandidate = (candidate, sourceUrl) => {
  const normalizedSource = normalizedIdentityUrl(sourceUrl);
  if (!normalizedSource) return false;
  if ([candidate.sourceUrl, candidate.facebookUrl, candidate.linkedinUrl]
    .some((url) => normalizedIdentityUrl(url) && (
      normalizedSource === normalizedIdentityUrl(url)
      || normalizedSource.startsWith(`${normalizedIdentityUrl(url)}/`)
    ))) return true;
  const platform = socialPlatformFromUrl(sourceUrl);
  const official = platform === 'Facebook' ? candidate.facebookUrl : platform === 'LinkedIn' ? candidate.linkedinUrl : '';
  const sourcePath = socialEntityPath(sourceUrl, platform);
  return !!(official && sourcePath && sourcePath === socialEntityPath(official, platform));
};

// A brand can contain a word from an unrelated industry. In particular,
// "Dating Cafe & Mart" has been misread as a matchmaking service and returned
// Tinder and dating websites as competitors. A cafe/mart is a physical food or
// retail business; a matchmaking platform is not a substitute for either.
const isClearlyDifferentIndustry = (target, candidate) => (
  /\b(?:cafe|café|coffee\s*shop|mart|grocery|restaurant)\b/i.test(target)
  && /\b(?:online dating|dating (?:app|website|site|platform|service)|matchmaking|singles (?:app|site|platform))\b/i.test(
    `${candidate.matchReason} ${candidate.positioning}`,
  )
);

// A dated post/video's own URL commonly encodes its Page's slug
// (facebook.com/<slug>/posts/... or /videos/...), but a reel URL
// (facebook.com/reel/<id>/) does not -- the model's search grounding often
// returns strong evidence for the former without a matching entry in
// discovery's separate "profiles" field, leaving the Page-link button empty
// even though we clearly know the business has a real, active Page. Recover
// that link from post evidence rather than showing nothing.
const FACEBOOK_PAGE_FROM_POST_URL = /^https:\/\/(?:www\.)?facebook\.com\/([^/?#]+)\/(?:posts|videos)\//i;
const NON_PAGE_FACEBOOK_PATH_SEGMENTS = new Set(['reel', 'watch', 'photo.php', 'permalink.php', 'groups', 'events', 'profile.php', 'story.php']);
const facebookPageUrlFromSource = (value) => {
  const key = facebookBusinessPageKey(value);
  if (!key) return '';
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    if (parts[0]?.toLowerCase() === 'pages') return `https://www.facebook.com/pages/${parts[1]}/${parts[2]}/`;
    return `https://www.facebook.com/${parts[0]?.toLowerCase() === 'pg' ? parts[1] : parts[0]}/`;
  } catch { return ''; }
};
const derivedFacebookPageUrl = (activities) => {
  for (const activity of activities) {
    const slug = String(activity?.sourceUrl || '').match(FACEBOOK_PAGE_FROM_POST_URL)?.[1];
    if (!slug || NON_PAGE_FACEBOOK_PATH_SEGMENTS.has(slug.toLowerCase())) continue;
    const candidateUrl = `https://www.facebook.com/${slug}`;
    if (validFacebookUrl(candidateUrl)) return candidateUrl;
  }
  return '';
};
const ACTIVITY_CONTENT_TYPES = new Set(['Video', 'Reel', 'Post', 'Article', 'Event', 'Offer', 'Ad', 'Other']);

const normalizeRecentActivities = (value, activityStartDate, activityEndDate) => {
  const normalized = (Array.isArray(value) ? value : [])
    .map((activity) => {
      const contentType = String(activity?.contentType || '').trim();
      const title = String(activity?.title || '').trim().slice(0, 240);
      const summary = String(activity?.summary || '').trim().slice(0, 1200);
      const keyDetails = (Array.isArray(activity?.keyDetails) ? activity.keyDetails : [])
        .map((detail) => String(detail || '').trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 6);
      return {
        date: String(activity?.date || '').trim(),
        activity: String(activity?.activity || '').trim().slice(0, 400),
        sourceUrl: String(activity?.sourceUrl || '').trim().slice(0, 300),
        ...(activity?.publisherPageUrl ? { publisherPageUrl: String(activity.publisherPageUrl).trim().slice(0, 300) } : {}),
        platform: socialPlatformFromUrl(activity?.sourceUrl),
        ...(ACTIVITY_CONTENT_TYPES.has(contentType) ? { contentType } : {}),
        ...(title ? { title } : {}),
        ...(summary ? { summary } : {}),
        ...(keyDetails.length ? { keyDetails } : {}),
      };
    })
    .filter((activity) => (
      /^\d{4}-\d{2}-\d{2}$/.test(activity.date)
      && activity.date >= activityStartDate
      && activity.date <= activityEndDate
      && activity.activity
      && /^https?:\/\//i.test(activity.sourceUrl)
    ))
  const merged = new Map();
  normalized.forEach((activity) => {
    const key = `${activity.date}|${activity.sourceUrl}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, activity);
      return;
    }
    const longerText = (left, right) => (String(right || '').length > String(left || '').length ? right : left);
    const contentType = existing.contentType || activity.contentType;
    const title = longerText(existing.title, activity.title);
    const summary = longerText(existing.summary, activity.summary);
    const keyDetails = [...new Set([...(existing.keyDetails || []), ...(activity.keyDetails || [])])].slice(0, 6);
    merged.set(key, {
      date: existing.date,
      activity: longerText(existing.activity, activity.activity),
      sourceUrl: existing.sourceUrl,
      ...(existing.publisherPageUrl || activity.publisherPageUrl
        ? { publisherPageUrl: existing.publisherPageUrl || activity.publisherPageUrl }
        : {}),
      platform: existing.platform,
      ...(contentType ? { contentType } : {}),
      ...(title ? { title } : {}),
      ...(summary ? { summary } : {}),
      ...(keyDetails.length ? { keyDetails } : {}),
    });
  });
  return [...merged.values()]
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, MAX_ACTIVITIES_PER_COMPETITOR);
};

// Runs one grounded search with up to one retry. `isUsable` decides whether a
// parsed response counts as real data (vs. an empty/malformed non-answer); a
// call that throws on both attempts propagates as a failure to `onFailure`,
// which lets discovery hard-fail while activity lookup degrades gracefully.
const searchWithRetry = async (prompt, { maxResults, maxTokens, isUsable, onFailure, imageDataUrl = '' }) => {
  let parsed = null;
  let lastError = null;
  for (let attempt = 0; attempt < MAX_SEARCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await generateOpenRouterWebSearch({ prompt, maxResults, maxTokens, ...(imageDataUrl && attempt === 0 ? { imageDataUrl } : {}) });
      parsed = jsonFromText(response.content);
      if (isUsable(parsed)) return parsed;
    } catch (error) {
      lastError = error;
      parsed = null;
    }
  }
  if (!parsed) return onFailure(lastError);
  return parsed;
};

export async function researchCompetitors({ query, targetDescription = '', targetFacebookPageUrl = '', targetLogoDataUrl = '', country = 'Cambodia', countryCode = 'KH', activityStartDate = '', activityEndDate = '', targetCount = 50 }) {
  const requestedTargetCount = Math.min(50, Math.max(1, Math.round(Number(targetCount) || 50)));
  const profileLogo = String(targetLogoDataUrl || '');
  const validProfileLogo = profileLogo.length <= 500_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(profileLogo);
  const hasActivityWindow = /^\d{4}-\d{2}-\d{2}$/.test(activityStartDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(activityEndDate)

  // STAGE 1 -- discovery. A single combined search across every source group
  // was tried first and measured live: it reliably spends most of its search
  // budget on whichever category is easiest to find (usually official sites/
  // directories) and comes back thin on the others, undercounting real
  // competitors for smaller/local businesses. Splitting into complementary
  // focused passes -- run concurrently, then merged by name below -- is the
  // same fix searchBusinessesOnWeb in _webBusinessSearch.js already uses for
  // the identical symptom on the customer-lead search. It deliberately does
  // not ask for activity yet (see the note on searchWithRetry below for why
  // that has to wait).
  const discoveryFocuses = [
    'Google/Apple map results, local business directories, and public marketplace listings: search the exact category plus the target city, province, and country. Include independent shops and service providers without a registered company website.',
    'PUBLIC PAGES: search site:facebook.com for real public business Pages and site:linkedin.com/company or /school for organization pages. A small business may use a public Page as its only online presence. Also check websites and contact pages when they exist. Never search TikTok or personal profiles.',
    'Customer review platforms, industry associations, credible local news, comparison lists, event exhibitor lists, marketplaces, and professional directories, to find direct competitors the other source groups miss.',
  ];
const buildDiscoveryPrompt = (focus) => `Search the live web about "${query}" in ${country}.
${targetDescription ? `The owner supplied this Business Profile description of the target: "${String(targetDescription).slice(0, 1000)}". Treat it as the target's own description of its offering. Independently verify every competitor and its source URL.` : ''}
${validFacebookUrl(targetFacebookPageUrl) ? `The Business Profile lists this public Facebook Page as its own: ${targetFacebookPageUrl}. Check its visible description and links before associating any differently named website or social page with the target.` : ''}
${validProfileLogo ? 'A reference image may be attached: it is the logo saved in this user\'s Business Profile. When visible public search evidence includes a Page or website logo, compare it visually if possible. A matching logo is a clue to investigate an alternate name, never proof by itself. Require corroborating description, contact details, or cross-links; reject a different company even if its name is similar.' : ''}

Step 1 -- Identify the target: determine whether "${query}" is the name of one specific real business/brand/organization, or a general product niche/category (e.g. "skincare", "women's fashion shop"). For a named business, use its FULL name and the saved Business Profile evidence above when supplied. A differently named Page or website can be the same business only when public descriptions, matching contact details, official cross-links, or a visually matching logo corroborated by another signal establish that connection. Record no link based on a shared word, logo alone, or visual similarity alone. Do not reinterpret a brand word as the business category: "Dating Cafe & Mart" is not a dating app unless a source explicitly says it sells matchmaking; a cafe or mart competes with other cafes or marts serving the same local customers.

Step 2 -- Find real competitors. SEARCH PASS FOCUS: ${focus}

A business only counts as a competitor if it meets ALL of these:
  (a) Same core industry/category -- it sells the same or a directly substitutable product/service as the target (from Step 1) or the stated niche.
  (b) Overlapping customers -- it targets a similar customer segment in the same geographic market (${country}, and the same city/region when the target is a local business).
  (c) Real and currently operating -- found via an actual public search result (its own website when it has one, a business directory or map listing, a marketplace listing, a real public Facebook business Page, or a LinkedIn organization page), not a defunct business or an unrelated mention of the same words. Formal company registration, a legal certificate, a LinkedIn page, and an official website are NOT requirements. A verifiable small shop or service provider with only a public business Page is eligible.
Every competitor you list MUST satisfy all three and come with a real source URL backing it. Explicitly exclude suppliers, distributors that do not sell a substitute, agencies serving the target, partners, customers, parent/sister companies, businesses that merely share a broad industry, and companies outside the real geographic/customer market. Include competitors at every size, not only ones as big as or bigger than the target -- a smaller or newer real competitor is still a valid entry, just labeled accordingly (see "marketPresence" below). Return up to ${requestedTargetCount} matches actually found; never target a quota and never pad the list. Search alternate spellings and local-language names so legitimate local businesses are not missed. Never invent a competitor name and never list one you cannot support with a real source URL.
If the target's product/service cannot be established from either the saved owner description (when provided) or live search evidence, return no competitors. Never substitute a similarly named business or the category suggested by one word of the target's name. A business with a strong, easy-to-find web presence is never a shortcut for verification: if the target is a small or local business with thin search coverage, that means few or zero real competitors should be returned, not that a prominent, well-indexed, but unrelated business should fill the gap. Before including any competitor, state specifically how its own real product/service is interchangeable with the target's from a customer's perspective -- a shared broad label like "education", "services", "academy", or "marketing" is not itself a match.
Every entry you return already met all three criteria above, so always set "isDirectCompetitor": true and "matchConfidence": "high" for it -- these are not separate judgment calls. If you are not fully confident a business satisfies all three, omit it entirely rather than listing it with a lower confidence; there is no "medium" or "low" tier, only include or exclude.

For each verified competitor, provide a short factual "matchReason" stating the exact overlapping product/service, customer group, and location supported by the search evidence. Also classify "marketPresence" relative to the target -- "stronger" (clearly bigger public footprint: more followers/engagement, more locations, more active marketing), "similar" (comparable scale and visibility), or "weaker" (smaller or less visible, but still a real, active, verifiable competitor) -- based only on what the search evidence actually shows, never a guess. Rank the list strongest presence first, but never drop a "weaker" entry just for being weaker. Search the public presence each business actually has: its business Page or map/directory listing may be the primary source when there is no website. Check a website or LinkedIn organization page when one exists. Never search TikTok. Only return URLs explicitly found in live results; never return a personal profile and never construct a URL from the company name. Only fill in "positioning" if the source actually supports it; otherwise leave it as an empty string rather than inferring.

Return ONLY a single valid JSON object, no markdown:
{
  "isSpecificEntity": true or false,
  "entitySummary": "one factual sentence on what the target actually is/does, based only on search results, or an empty string if not found",
  "competitors": [
    {
      "name": "exact real name",
      "isDirectCompetitor": true,
      "matchConfidence": "high",
      "matchReason": "factual reason this is a direct competitor, grounded in the source",
      "marketPresence": "stronger, similar, or weaker, relative to the target",
      "positioning": "only if directly supported by the source, else empty string",
      "facebookUrl": "official public Facebook business Page URL if found, else empty string",
      "websiteUrl": "official business website URL if found, else empty string; never a directory or marketplace listing",
      "tiktokUrl": "",
      "linkedinUrl": "official LinkedIn company/school/showcase page URL if found, else empty string",
      "sourceUrl": "the exact URL this came from"
    }
  ]
}
If nothing reliable was found, return {"isSpecificEntity": false, "entitySummary": "", "competitors": []}.`;

  const discoverySettled = await Promise.allSettled(discoveryFocuses.map((focus) => searchWithRetry(buildDiscoveryPrompt(focus), {
    maxResults: DISCOVERY_MAX_RESULTS,
    maxTokens: DISCOVERY_MAX_TOKENS,
    imageDataUrl: validProfileLogo ? profileLogo : '',
    isUsable: (parsed) => parsed?.isSpecificEntity !== undefined
      || (Array.isArray(parsed?.competitors) && parsed.competitors.length > 0),
    onFailure: (lastError) => { throw lastError || new Error('Competitor search failed.'); },
  })));
  const discoveryResults = discoverySettled
    .filter((settled) => settled.status === 'fulfilled')
    .map((settled) => settled.value);
  if (!discoveryResults.length) {
    const firstFailure = discoverySettled.find((settled) => settled.status === 'rejected');
    throw firstFailure?.reason || new Error('Competitor search failed.');
  }
  // Step 1 (identify the target) is redundant work repeated in every focused
  // pass -- any pass that actually found something is an equally valid source
  // for it, so just take the first one with real content instead of
  // reconciling three separate judgments of the same question.
  const discoveryParsed = discoveryResults.find((parsed) => parsed?.entitySummary) || discoveryResults[0];
  const isNamedTarget = Boolean(targetDescription || targetFacebookPageUrl || validProfileLogo)
    || discoveryResults.some((parsed) => parsed?.isSpecificEntity === true);

  const mergedCandidates = new Map();
  discoveryResults.flatMap((parsed) => (Array.isArray(parsed?.competitors) ? parsed.competitors : [])).forEach((item) => {
    const facebookUrl = String(item?.facebookUrl || '').trim().slice(0, 300);
    const linkedinUrl = String(item?.linkedinUrl || '').trim().slice(0, 300);
    const isDirectCompetitor = item?.isDirectCompetitor === true;
    const matchConfidence = String(item?.matchConfidence || '').trim().toLowerCase();
    const marketPresence = String(item?.marketPresence || '').trim().toLowerCase();
    const candidate = {
      name: String(item?.name || '').trim().slice(0, 200),
      matchReason: String(item?.matchReason || '').trim().slice(0, 500),
      marketPresence: ['stronger', 'similar', 'weaker'].includes(marketPresence) ? marketPresence : '',
      positioning: String(item?.positioning || '').trim().slice(0, 300),
      facebookUrl: validFacebookUrl(facebookUrl) ? facebookUrl : facebookPageUrlFromSource(item?.sourceUrl),
      websiteUrl: businessWebsiteUrl(item?.websiteUrl),
      tiktokUrl: '',
      linkedinUrl: validLinkedInUrl(linkedinUrl) ? linkedinUrl : '',
      sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 300),
      recentActivities: [],
      lastKnownActivity: null,
    };
    if (!isDirectCompetitor || matchConfidence !== 'high' || !candidate.matchReason) return;
    if (isClearlyDifferentIndustry(query, candidate)) return;
    if (!candidate.name || !/^https?:\/\//i.test(candidate.sourceUrl) || socialPlatformFromUrl(candidate.sourceUrl) === 'TikTok') return;
    if (isNamedTarget && competitorKey(candidate.name) === competitorKey(query)) return;
    const targetPage = facebookBusinessPageKey(targetFacebookPageUrl);
    if (targetPage && [candidate.sourceUrl, candidate.facebookUrl].some((url) => facebookBusinessPageKey(url) === targetPage)) return;
    const nameKey = competitorKey(candidate.name);
    if (!nameKey) return;
    const matched = [...mergedCandidates.entries()].find(([, previous]) => (
      competitorKey(previous.name) === nameKey && sharesPublicIdentity(previous, candidate)
    ));
    const key = matched?.[0] || `${nameKey}|${mergedCandidates.size}`;
    const existing = matched?.[1];
    if (!existing) {
      mergedCandidates.set(key, candidate);
      return;
    }
    mergedCandidates.set(key, {
      ...existing,
      matchReason: existing.matchReason || candidate.matchReason,
      marketPresence: existing.marketPresence || candidate.marketPresence,
      positioning: existing.positioning || candidate.positioning,
      facebookUrl: existing.facebookUrl || candidate.facebookUrl,
      websiteUrl: existing.websiteUrl || candidate.websiteUrl,
      tiktokUrl: existing.tiktokUrl || candidate.tiktokUrl,
      linkedinUrl: existing.linkedinUrl || candidate.linkedinUrl,
    });
  });
  // Keep broad discovery useful while bounding outbound requests so a large or
  // malformed model response cannot exhaust a serverless invocation.
  const candidates = [...mergedCandidates.values()].slice(0, MAX_COMPETITOR_CANDIDATES);
  const candidateForEvidence = (name, sourceUrl) => {
    const matches = candidates.filter((candidate) => competitorKey(candidate.name) === competitorKey(name));
    if (matches.length === 1) return matches[0];
    const sourced = matches.filter((candidate) => sourceIdentifiesCandidate(candidate, sourceUrl));
    return sourced.length === 1 ? sourced[0] : null;
  };

  // STAGE 2 -- activity, only once the exact names are known. This has to be
  // its own call: a search plugin resolves its queries from the prompt before
  // the model has written any output, so it cannot form a targeted
  // "site:facebook.com <name>" query for a business the same call is still in
  // the middle of discovering. Listing every already-verified name here is
  // what makes per-company search actually work, instead of the search budget
  // going to generic category terms.
  if (hasActivityWindow && candidates.length) {
    const buildActivityPrompt = (lookupCandidates, { platformOnly = '' } = {}) => {
      const businessList = lookupCandidates.map((candidate) => {
        const knownSources = platformOnly === 'Facebook'
          ? [candidate.facebookUrl].filter(Boolean)
          : [candidate.sourceUrl, candidate.facebookUrl, candidate.linkedinUrl].filter(Boolean);
        return `- ${candidate.name}${knownSources.length ? ` (known official ${platformOnly || 'public'} URLs: ${knownSources.join(', ')})` : ''}`;
      }).join('\n');
      const searchScope = platformOnly === 'Facebook'
        ? 'Search ONLY Facebook for each business. First locate its exact official public business Page with a site:facebook.com query, then inspect that Page for dated posts, reels, videos, offers, events, or announcements. Do not search or return TikTok, LinkedIn, websites, directories, or personal Facebook profiles. A result is valid only when its URL is on facebook.com or fb.com.'
        : 'For EACH business listed above, individually search its known public sources and any discoverable official website, Facebook business Page, or LinkedIn organization Updates for a dated post, offer, event, launch, article, or campaign. A Page-only business remains eligible. Never search TikTok.';
      const emptyResultRule = platformOnly
        ? `Return an empty activities array only after checking ${platformOnly} separately for every listed business. Still return an official profile in profiles when one is found, even when it has no dated activity in this exact window.`
        : 'Return {"activities": []} only after checking the official website, Facebook, and LinkedIn for every listed business and finding no dated activity in this exact window.';
      const fallbackEvidenceRule = platformOnly
        ? 'Prefer the direct post/video URL. Use an official Page/profile URL as activity evidence only when its visible search result contains that specific dated activity; a profile URL may always be returned separately in profiles but never counts as an activity by itself.'
        : "Prefer the direct content URL. When Facebook or LinkedIn exposes a clearly dated update only inside the exact business's official Page/organization Updates feed, that official Page/organization URL is acceptable fallback evidence; never use a generic profile page unless the rendered search result visibly contains that specific dated activity.";
      const sourceUrlDescription = platformOnly === 'Facebook'
        ? 'direct facebook.com or fb.com evidence URL'
        : 'direct public evidence URL or the official Page/organization Updates URL fallback described above';
      const profilesShape = platformOnly
        ? `  "profiles": [{ "competitorName": "exact name copied from the supplied list", "profileUrl": "official ${platformOnly} Page/profile URL" }],\n`
        : '';
      // A blanket "no activity in this 7-day window" line reads the same
      // whether a business posted yesterday or hasn't posted in months --
      // asking separately for the single most recent verifiable post (of any
      // age) for exactly the businesses missing in-window activity lets the UI
      // say "last posted on <date>" instead, without spending search budget
      // chasing a full history for businesses that already have in-window hits.
      const lastActivityRule = `For every listed business that has NO dated activity inside the window above, ALSO search the same source(s) for that business's single most recent dated post/video/update of any age (it will normally fall before ${activityStartDate}) and report it in "lastActivity" so we can state exactly when they last posted. Include at most one "lastActivity" entry per business -- the most recent one you can verify -- grounded in a real dated source. Omit a business from "lastActivity" entirely if it already has an entry in "activities", or if no dated post can be verified at all.`;
      return `Search the live public web for activity posted by ONLY these exact businesses in ${country}:\n${businessList}\n\nDATE WINDOW: ${activityStartDate} through ${activityEndDate}, inclusive. Treat ${activityEndDate} as the current local calendar date. A source label such as "6h", "1d", "2d", or "5 days ago" is valid dated evidence: normalize it to YYYY-MM-DD by counting back from ${activityEndDate}.\n\n${searchScope} Check every requested source for every single business before moving on -- do not stop early after finding activity for only the first few names. ${fallbackEvidenceRule}\n\n${lastActivityRule}\n\nGROUNDING RULES: describe only facts visible in the public source, search-result extract, caption, title, description, or indexed transcript. For an opaque Facebook reel or LinkedIn feed URL that does not contain the Page/organization identity, include its independently observed publisherPageUrl; leave the activity out if its publisher cannot be tied to the listed business. For a video/reel, explain what it discusses or demonstrates only when its caption, description, visible text, or transcript supports that explanation. Never invent spoken words, scenes, results, offers, prices, audience reactions, or business actions. If detailed content is unavailable, keep summary and keyDetails empty instead of guessing.\n\nReturn ONLY valid JSON in this shape:\n{\n${profilesShape}  "activities": [\n    {\n      "competitorName": "exact name copied from the supplied list",\n      "date": "YYYY-MM-DD",\n      "contentType": "Video, Reel, Post, Article, Event, Offer, Ad, or Other",\n      "title": "exact visible title/headline, or a short factual label grounded in the source",\n      "activity": "one concise sentence stating what the business posted or announced",\n      "summary": "2-4 factual sentences explaining what the content is about, using only details visible in the source; empty string if unavailable",\n      "keyDetails": ["up to 6 concrete facts explicitly supported by the source"],\n      "publisherPageUrl": "public Page/organization URL proving the publisher for opaque reel/feed URLs, else empty string",\n      "sourceUrl": "${sourceUrlDescription}"\n    }\n  ],\n  "lastActivity": [\n    {\n      "competitorName": "exact name copied from the supplied list",\n      "date": "YYYY-MM-DD",\n      "activity": "one concise sentence stating what the business posted or announced",\n      "publisherPageUrl": "public Page/organization URL proving the publisher for opaque URLs, else empty string",\n      "sourceUrl": "${sourceUrlDescription}"\n    }\n  ]\n}\n${emptyResultRule}`;
    };

    const activityLookupCandidates = candidates.slice(0, ACTIVITY_LOOKUP_LIST_CAP);
    const mergeActivities = (activities, allowedPlatforms = null) => {
      (Array.isArray(activities) ? activities : []).forEach((activity) => {
        const sourcePlatform = socialPlatformFromUrl(activity?.sourceUrl);
        if (sourcePlatform === 'TikTok' || (allowedPlatforms && !allowedPlatforms.has(sourcePlatform))) return;
        const candidate = candidateForEvidence(activity?.competitorName, activity?.publisherPageUrl || activity?.sourceUrl);
        if (!candidate || !activityBelongsToCandidate(candidate, activity?.sourceUrl, activity?.publisherPageUrl)) return;
        candidate.recentActivities = normalizeRecentActivities(
          [...(candidate.recentActivities || []), activity],
          activityStartDate,
          activityEndDate,
        );
      });
    };
    // Only fills in a fallback "last known" date -- never overwrites a
    // business that already has real in-window activity, and keeps whichever
    // candidate entry (mixed-source vs. platform-only pass) is more recent.
    const mergeLastActivity = (entries, allowedPlatforms = null) => {
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const date = String(entry?.date || '').trim();
        const sourceUrl = String(entry?.sourceUrl || '').trim().slice(0, 300);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^https?:\/\//i.test(sourceUrl)) return;
        const platform = socialPlatformFromUrl(sourceUrl);
        if (platform === 'TikTok' || (allowedPlatforms && !allowedPlatforms.has(platform))) return;
        const candidate = candidateForEvidence(entry?.competitorName, entry?.publisherPageUrl || sourceUrl);
        if (!candidate || candidate.recentActivities?.length || !activityBelongsToCandidate(candidate, sourceUrl, entry?.publisherPageUrl)) return;
        if (candidate.lastKnownActivity && candidate.lastKnownActivity.date >= date) return;
        candidate.lastKnownActivity = {
          date,
          activity: String(entry?.activity || '').trim().slice(0, 400) || 'Most recent verified public post found.',
          sourceUrl,
          ...(entry?.publisherPageUrl ? { publisherPageUrl: String(entry.publisherPageUrl).trim().slice(0, 300) } : {}),
          platform,
        };
      });
    };
    const mergeSocialProfiles = (profiles, platform) => {
      const urlField = 'facebookUrl';
      const validUrl = validFacebookUrl;
      (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
        const profileUrl = String(profile?.profileUrl || '').trim().slice(0, 300);
        const candidate = candidateForEvidence(profile?.competitorName, profileUrl);
        if (!candidate || candidate[urlField] || !validUrl(profileUrl)) return;
        candidate[urlField] = profileUrl;
      });
    };

    const activityParsed = await searchWithRetry(buildActivityPrompt(activityLookupCandidates), {
      maxResults: ACTIVITY_MAX_RESULTS,
      maxTokens: ACTIVITY_MAX_TOKENS,
      isUsable: (parsed) => Array.isArray(parsed?.activities) && parsed.activities.length > 0,
      // Activity is enrichment, not the core result -- a failed or empty
      // activity search still returns the verified competitor list, just
      // without dated activity, rather than failing the whole lookup.
      onFailure: () => ({ activities: [] }),
    });
    mergeActivities(activityParsed?.activities);
    mergeLastActivity(activityParsed?.lastActivity);

    // STAGE 3 -- direct public Facebook/TikTok lookup. Search indexes often
    // miss recent social posts. When configured, this queries only the exact
    // official Page/profile URLs discovered in stage 1 and returns direct
    // post/video evidence. It is optional and always fails open.
    if (isApifySocialActivityConfigured()) {
      try {
        mergeActivities(
          await fetchApifySocialActivity({
            candidates: activityLookupCandidates,
            startDate: activityStartDate,
            endDate: activityEndDate,
          }),
          new Set(['Facebook']),
        );
      } catch {
        // The web-search fallback below still runs for missing platforms.
      }
    }

    // A mixed-source call tends to spend its search budget on LinkedIn because
    // it indexes more readily. Give Facebook and TikTok one independent pass
    // each so finding LinkedIn never suppresses either source. These passes
    // also retain an official Page/profile URL even when no dated post was
    // indexed; direct enrichment can then inspect that feed instead of being
    // skipped merely because discovery did not return the social URL.
    const initialSocialUrls = new Map(activityLookupCandidates.map((candidate) => [
      candidate,
      { facebookUrl: candidate.facebookUrl },
    ]));
    const socialSearchTasks = ['Facebook'].flatMap((platform) => {
      const missingPlatform = activityLookupCandidates.filter((candidate) => (
        !(candidate.recentActivities || []).some((activity) => activity.platform === platform)
      ));
      const batches = [];
      for (let i = 0; i < missingPlatform.length; i += SOCIAL_LOOKUP_BATCH_SIZE) {
        batches.push(missingPlatform.slice(i, i + SOCIAL_LOOKUP_BATCH_SIZE));
      }
      return batches.map((batch) => ({ platform, batch }));
    });
    const socialSearches = await Promise.allSettled(socialSearchTasks.map(async ({ platform, batch }) => {
      const response = await generateOpenRouterWebSearch({
        prompt: buildActivityPrompt(batch, { platformOnly: platform }),
        maxResults: ACTIVITY_MAX_RESULTS,
        maxTokens: ACTIVITY_MAX_TOKENS,
      });
      return { platform, parsed: jsonFromText(response?.content) };
    }));
    socialSearches.forEach((settled) => {
      if (settled.status !== 'fulfilled' || !settled.value?.parsed) return;
      const { platform, parsed } = settled.value;
      mergeSocialProfiles(parsed.profiles, platform);
      mergeActivities(parsed.activities, new Set([platform]));
      mergeLastActivity(parsed.lastActivity, new Set([platform]));
    });

    // A search for recent posts can miss an existing Page with no indexed
    // activity. Look up the Page itself for every still-unlinked competitor.
    const missingFacebookPages = activityLookupCandidates.filter((candidate) => !candidate.facebookUrl);
    const profileBatches = [];
    for (let i = 0; i < missingFacebookPages.length; i += SOCIAL_LOOKUP_BATCH_SIZE) {
      profileBatches.push(missingFacebookPages.slice(i, i + SOCIAL_LOOKUP_BATCH_SIZE));
    }
    const profileSearches = await Promise.allSettled(profileBatches.map(async (batch) => {
      const identities = batch.map((candidate) => `- ${candidate.name} | known source: ${candidate.sourceUrl}${candidate.linkedinUrl ? ` | LinkedIn: ${candidate.linkedinUrl}` : ''}`).join('\n');
      const response = await generateOpenRouterWebSearch({
        prompt: `Find the official public Facebook business Page for EACH of these verified businesses in ${country}:\n${identities}\nSearch site:facebook.com with each exact business name and alternate public name. Check the Page description, location, logo when visible, contact details, and links against the known source. This is a Page lookup, independent of whether the business posted recently or at all. Never invent a Page URL or use a personal profile, post, reel, group, or another company's Page. Omit a business if its official Page cannot be identified from public search results. Return only JSON: {"profiles":[{"competitorName":"exact name from list","profileUrl":"observed official Facebook Page URL"}]}.`,
        maxResults: ACTIVITY_MAX_RESULTS,
        maxTokens: 4000,
      });
      return jsonFromText(response?.content)?.profiles;
    }));
    profileSearches.forEach((settled) => {
      if (settled.status === 'fulfilled') mergeSocialProfiles(settled.value, 'Facebook');
    });

    // The first direct pass can only use URLs known during discovery. If a
    // platform-only search just found a missing official URL, immediately use
    // it for one direct pass so indexed LinkedIn results are no longer the end
    // of the pipeline.
    if (isApifySocialActivityConfigured()) {
      const newlyAddressable = activityLookupCandidates.filter((candidate) => {
        const initial = initialSocialUrls.get(candidate) || {};
        return !initial.facebookUrl && candidate.facebookUrl;
      });
      if (newlyAddressable.length) {
        try {
          mergeActivities(
            await fetchApifySocialActivity({
              candidates: newlyAddressable,
              startDate: activityStartDate,
              endDate: activityEndDate,
            }),
            new Set(['Facebook']),
          );
        } catch {
          // Best-effort enrichment; keep the grounded web-search results.
        }
      }
    }

    // STAGE 4 -- Meta Ad Library. Meta exposes ordinary commercial ads through
    // this API only for EU/UK delivery; elsewhere (including Cambodia) it
    // returns political/issue ads only. isMetaAdLibraryConfigured(countryCode)
    // therefore keeps this enrichment out of unsupported market scans.
    if (isMetaAdLibraryConfigured(countryCode)) {
      await mapWithConcurrency(activityLookupCandidates, URL_VERIFICATION_CONCURRENCY, async (candidate) => {
        if (candidates.filter((other) => competitorKey(other.name) === competitorKey(candidate.name)).length > 1) return;
        const adActivities = await fetchMetaAdLibraryActivity({
          businessName: candidate.name,
          countryCode,
          startDate: activityStartDate,
          endDate: activityEndDate,
        });
        if (!adActivities.length) return;
        candidate.recentActivities = normalizeRecentActivities(
          [...(candidate.recentActivities || []), ...adActivities],
          activityStartDate,
          activityEndDate,
        );
      });
    }
  }

  if (hasActivityWindow) {
    const missingWebsites = candidates.slice(0, ACTIVITY_LOOKUP_LIST_CAP).filter((candidate) => !candidate.websiteUrl);
    const websiteBatches = [];
    for (let i = 0; i < missingWebsites.length; i += SOCIAL_LOOKUP_BATCH_SIZE) {
      websiteBatches.push(missingWebsites.slice(i, i + SOCIAL_LOOKUP_BATCH_SIZE));
    }
    const websiteSearches = await Promise.allSettled(websiteBatches.map(async (batch) => {
      const identities = batch.map((candidate) => `- ${candidate.name} | known source: ${candidate.sourceUrl}${candidate.facebookUrl ? ` | Facebook: ${candidate.facebookUrl}` : ''}`).join('\n');
      const response = await generateOpenRouterWebSearch({
        prompt: `Find the official business website for EACH of these verified competitors in ${country}:\n${identities}\nSearch each exact name and alternate public name. Match the website's business description, location, contact details, logo when visible, or official cross-links to the known source. This website lookup is independent of recent posts. Return only a company's own website, never a directory, marketplace, news article, social Page, or another company's site. Do not construct a domain from its name. Omit a business if no official website is supported by public search results. Return only JSON: {"websites":[{"competitorName":"exact name from list","knownSourceUrl":"exact known source from list","websiteUrl":"observed official website URL"}]}.`,
        maxResults: ACTIVITY_MAX_RESULTS,
        maxTokens: 4000,
      });
      return jsonFromText(response?.content)?.websites;
    }));
    websiteSearches.forEach((settled) => {
      if (settled.status !== 'fulfilled') return;
      (Array.isArray(settled.value) ? settled.value : []).forEach((entry) => {
        const candidate = candidateForEvidence(entry?.competitorName, entry?.knownSourceUrl);
        const websiteUrl = businessWebsiteUrl(entry?.websiteUrl);
        if (candidate && normalizedIdentityUrl(entry?.knownSourceUrl) === normalizedIdentityUrl(candidate.sourceUrl)
          && !candidate.websiteUrl && websiteUrl) candidate.websiteUrl = websiteUrl;
      });
    });
  }

  // Same real-HTTP-check pattern as _webBusinessSearch.js: a fabricated or
  // dead source URL is the actual failure mode worth guarding against here.
  // Activity URLs are checked sequentially within each worker, keeping total
  // outbound verification concurrency at the worker limit.
  const verified = (await mapWithConcurrency(candidates, URL_VERIFICATION_CONCURRENCY, async (item) => {
    // Public social networks commonly reject server-side HEAD/GET checks even
    // for real public pages. These URLs already came from grounded search, so
    // validate their exact supported host/shape instead of dropping them on a
    // platform anti-bot response. Ordinary web sources still require HTTP.
    const sourcePlatform = socialPlatformFromUrl(item.sourceUrl);
    if (sourcePlatform === 'Facebook') {
      const sourcePage = facebookBusinessPageKey(item.sourceUrl);
      const listedPage = facebookBusinessPageKey(item.facebookUrl);
      if (!sourcePage) return null;
      if (listedPage && sourcePage !== listedPage) item.facebookUrl = '';
    }
    if (sourcePlatform === 'LinkedIn' && !validLinkedInUrl(item.sourceUrl)) return null;
    if (!isSupportedPublicSocialUrl(item.sourceUrl) && !(await urlIsReachable(item.sourceUrl))) return null;
    const activityChecks = [];
    for (const activity of item.recentActivities || []) {
      if (activityBelongsToCandidate(item, activity.sourceUrl, activity.publisherPageUrl)
        && (isSupportedPublicSocialUrl(activity.sourceUrl) || await urlIsReachable(activity.sourceUrl))) activityChecks.push(activity);
    }
    let lastKnownActivity = null;
    if (item.lastKnownActivity
      && activityBelongsToCandidate(item, item.lastKnownActivity.sourceUrl, item.lastKnownActivity.publisherPageUrl)
      && (isSupportedPublicSocialUrl(item.lastKnownActivity.sourceUrl) || await urlIsReachable(item.lastKnownActivity.sourceUrl))) {
      lastKnownActivity = item.lastKnownActivity;
    }
    // Unlike sourceUrl/activity evidence above, the TikTok/LinkedIn profile
    // links shown on a competitor card ARE live-HTTP-checked here on request,
    // so a link a user clicks actually opens -- accepting that an anti-bot
    // block on a real page occasionally clears a genuine link, the same risk
    // urlIsReachable already tolerates elsewhere. A page that fails the check
    // is blanked, not treated as grounds to drop the whole competitor.
    //
    // Facebook is excluded from this: verified directly against facebook.com/
    // facebook, /nike, and /cocacola (huge, definitely-real, definitely-live
    // pages) from this server, and Facebook's edge returned a bare 400 Bad
    // Request for every single one, before ever reaching page content. That
    // means a live check here cannot distinguish a real Facebook Page from a
    // dead one -- it would blank every genuine link, which is worse than the
    // occasional anti-bot false negative this pattern is elsewhere built to
    // tolerate. Trust the format-validated URL from grounded search instead,
    // same as sourceUrl/activity evidence already does via
    // isSupportedPublicSocialUrl.
    const verifiedSocialUrl = async (url) => (url && await urlIsReachable(url)) ? url : '';
    const linkedinUrl = await verifiedSocialUrl(item.linkedinUrl);
    const tiktokUrl = '';
    const facebookUrl = item.facebookUrl || derivedFacebookPageUrl(activityChecks) || '';
    const websiteUrl = item.websiteUrl && (item.websiteUrl === item.sourceUrl || await urlIsReachable(item.websiteUrl)) ? item.websiteUrl : '';
    const verifiedItem = { ...item };
    delete verifiedItem.websiteUrl;
    return hasActivityWindow ? { ...verifiedItem, ...(websiteUrl ? { websiteUrl } : {}), facebookUrl, tiktokUrl, linkedinUrl, recentActivities: activityChecks.filter(Boolean), lastKnownActivity } : { name: item.name, matchReason: item.matchReason, marketPresence: item.marketPresence, positioning: item.positioning, ...(websiteUrl ? { websiteUrl } : {}), facebookUrl, tiktokUrl, linkedinUrl, sourceUrl: item.sourceUrl };
  })).filter(Boolean);

  return {
    isSpecificEntity: !!discoveryParsed?.isSpecificEntity,
    entitySummary: String(discoveryParsed?.entitySummary || '').trim().slice(0, 400),
    competitors: verified,
  };
}
