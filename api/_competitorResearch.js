// Grounds competitor intelligence in live web search results instead of letting
// the main strategy prompt name competitors from the model's own memory --
// for a small/unfamiliar business name (e.g. a specific local company rather
// than a well-known brand) the model has no real knowledge of who it competes
// with, and asking it to guess produces plausible-sounding but fabricated
// names. This searches the live web first and only returns competitors that
// come from an actual, independently-checked source URL.
import { generateOpenRouterWebSearch } from './_openrouter.js';
import { urlIsReachable } from './_webBusinessSearch.js';
import { socialPlatformFromUrl, validFacebookUrl, validTikTokUrl, validLinkedInUrl, isSupportedPublicSocialUrl } from './_socialUrls.js';
import { fetchMetaAdLibraryActivity, isMetaAdLibraryConfigured } from './_metaAdLibrary.js';
import { fetchApifySocialActivity, isApifySocialActivityConfigured } from './_apifySocialActivity.js';

export { socialPlatformFromUrl };

const MAX_COMPETITOR_CANDIDATES = 75;
const URL_VERIFICATION_CONCURRENCY = 8;
const MAX_ACTIVITIES_PER_COMPETITOR = 14;
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

// A dated post/video's own URL commonly encodes its Page's slug
// (facebook.com/<slug>/posts/... or /videos/...), but a reel URL
// (facebook.com/reel/<id>/) does not -- the model's search grounding often
// returns strong evidence for the former without a matching entry in
// discovery's separate "profiles" field, leaving the Page-link button empty
// even though we clearly know the business has a real, active Page. Recover
// that link from post evidence rather than showing nothing.
const FACEBOOK_PAGE_FROM_POST_URL = /^https:\/\/(?:www\.)?facebook\.com\/([^/?#]+)\/(?:posts|videos)\//i;
const NON_PAGE_FACEBOOK_PATH_SEGMENTS = new Set(['reel', 'watch', 'photo.php', 'permalink.php', 'groups', 'events', 'profile.php', 'story.php']);
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
const searchWithRetry = async (prompt, { maxResults, maxTokens, isUsable, onFailure }) => {
  let parsed = null;
  let lastError = null;
  for (let attempt = 0; attempt < MAX_SEARCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await generateOpenRouterWebSearch({ prompt, maxResults, maxTokens });
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

export async function researchCompetitors({ query, country = 'Cambodia', countryCode = 'KH', activityStartDate = '', activityEndDate = '', targetCount = 50 }) {
  const requestedTargetCount = Math.min(50, Math.max(1, Math.round(Number(targetCount) || 50)));
  const hasActivityWindow = /^\d{4}-\d{2}-\d{2}$/.test(activityStartDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(activityEndDate)

  // STAGE 1 -- discovery. One combined search across every source group finds
  // the real competitor names; it deliberately does not ask for activity yet
  // (see the note on searchWithRetry below for why that has to wait).
  const discoveryPrompt = `Search the live web about "${query}" in ${country}.

Step 1 -- Identify the target: determine whether "${query}" is the name of one specific real business/brand/organization, or a general product niche/category (e.g. "skincare", "women's fashion shop"). Base this only on what real search results show -- never guess.

Step 2 -- Find real competitors by searching ALL of these source groups in this same search, not just one of them:
  - Official company websites, Google/Apple map results, and local business directories: search the exact category plus the target city, province, and country.
  - FACEBOOK: site:facebook.com for real public business Pages. Return the exact Page URL. Never use personal profiles or private content.
  - TIKTOK: site:tiktok.com for official public business profiles. Return the exact @profile URL. Never guess a handle and never use an unrelated creator.
  - LINKEDIN: site:linkedin.com/company, site:linkedin.com/school, and public organization pages. Return the exact organization URL. Never use personal profiles.
  - Customer review platforms, industry associations, credible local news, comparison lists, event exhibitor lists, marketplaces, and professional directories, to find direct competitors the other groups missed.

A business only counts as a competitor if it meets ALL of these:
  (a) Same core industry/category -- it sells the same or a directly substitutable product/service as the target (from Step 1) or the stated niche.
  (b) Overlapping customers -- it targets a similar customer segment in the same geographic market (${country}, and the same city/region when the target is a local business).
  (c) Currently active and real -- found via an actual, live search result (its own website, a business directory listing, a comparison article, a news mention, a real Facebook Page, or an official LinkedIn company/school page), not a defunct business or an unrelated mention of the same words.
  (d) Equal or stronger market presence -- prioritize businesses that are at least as established as the target, or more so: a more visible public footprint, more active marketing/content, more locations, more followers/engagement, or broader brand recognition. The point of this scan is to learn from competitors who are ahead, so do not fill the list with smaller or clearly weaker businesses that trail behind the target just because they are easy to find. Only exclude a business here if it is an unrelated large multinational conglomerate outside the target's real category/market -- a strong, well-known player that genuinely competes in the same category and market always counts.
Every competitor you list MUST satisfy all four and come with a real source URL backing it. Explicitly exclude suppliers, distributors that do not sell a substitute, agencies serving the target, partners, customers, parent/sister companies, businesses that merely share a broad industry, and companies outside the real geographic/customer market. Rank the strongest, most prominent direct competitors first based on visible public market presence and relevance to the same customers, not on guessed revenue or private data -- put the biggest real threats at the top, not the smallest. Return up to ${requestedTargetCount} strong matches actually found; never target a quota and never pad the list. Search alternate spellings and local-language names so legitimate local businesses are not missed. Never invent a competitor name and never list one you cannot support with a real source URL.
Every entry you return already met all four criteria above, so always set "isDirectCompetitor": true and "matchConfidence": "high" for it -- these are not separate judgment calls. If you are not fully confident a business satisfies all four, omit it entirely rather than listing it with a lower confidence; there is no "medium" or "low" tier, only include or exclude.

For each verified competitor, provide a short factual "matchReason" stating the exact overlapping product/service, customer group, and location supported by the search evidence. Search for its official Facebook Page, TikTok @profile, and LinkedIn organization page. Only return URLs explicitly found in live results; never return a personal profile and never construct a URL from the company name. Only fill in "positioning" if the source actually supports it; otherwise leave it as an empty string rather than inferring.

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
      "positioning": "only if directly supported by the source, else empty string",
      "facebookUrl": "official public Facebook business Page URL if found, else empty string",
      "tiktokUrl": "official public TikTok @profile URL if found, else empty string",
      "linkedinUrl": "official LinkedIn company/school/showcase page URL if found, else empty string",
      "sourceUrl": "the exact URL this came from"
    }
  ]
}
If nothing reliable was found, return {"isSpecificEntity": false, "entitySummary": "", "competitors": []}.`;

  const discoveryParsed = await searchWithRetry(discoveryPrompt, {
    maxResults: DISCOVERY_MAX_RESULTS,
    maxTokens: DISCOVERY_MAX_TOKENS,
    isUsable: (parsed) => parsed?.isSpecificEntity !== undefined
      || (Array.isArray(parsed?.competitors) && parsed.competitors.length > 0),
    onFailure: (lastError) => { throw lastError || new Error('Competitor search failed.'); },
  });

  const mergedCandidates = new Map();
  (Array.isArray(discoveryParsed?.competitors) ? discoveryParsed.competitors : []).forEach((item) => {
    const facebookUrl = String(item?.facebookUrl || '').trim().slice(0, 300);
    const tiktokUrl = String(item?.tiktokUrl || '').trim().slice(0, 300);
    const linkedinUrl = String(item?.linkedinUrl || '').trim().slice(0, 300);
    const isDirectCompetitor = item?.isDirectCompetitor === true;
    const matchConfidence = String(item?.matchConfidence || '').trim().toLowerCase();
    const candidate = {
      name: String(item?.name || '').trim().slice(0, 200),
      matchReason: String(item?.matchReason || '').trim().slice(0, 500),
      positioning: String(item?.positioning || '').trim().slice(0, 300),
      facebookUrl: validFacebookUrl(facebookUrl) ? facebookUrl : '',
      tiktokUrl: validTikTokUrl(tiktokUrl) ? tiktokUrl : '',
      linkedinUrl: validLinkedInUrl(linkedinUrl) ? linkedinUrl : '',
      sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 300),
      recentActivities: [],
      lastKnownActivity: null,
    };
    if (!isDirectCompetitor || matchConfidence !== 'high' || !candidate.matchReason) return;
    if (!candidate.name || !/^https?:\/\//i.test(candidate.sourceUrl)) return;
    const key = competitorKey(candidate.name);
    if (!key) return;
    const existing = mergedCandidates.get(key);
    if (!existing) {
      mergedCandidates.set(key, candidate);
      return;
    }
    mergedCandidates.set(key, {
      ...existing,
      matchReason: existing.matchReason || candidate.matchReason,
      positioning: existing.positioning || candidate.positioning,
      facebookUrl: existing.facebookUrl || candidate.facebookUrl,
      tiktokUrl: existing.tiktokUrl || candidate.tiktokUrl,
      linkedinUrl: existing.linkedinUrl || candidate.linkedinUrl,
    });
  });
  // Keep broad discovery useful while bounding outbound requests so a large or
  // malformed model response cannot exhaust a serverless invocation.
  const candidates = [...mergedCandidates.values()].slice(0, MAX_COMPETITOR_CANDIDATES);

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
          : platformOnly === 'TikTok'
            ? [candidate.tiktokUrl].filter(Boolean)
          : [candidate.facebookUrl, candidate.tiktokUrl, candidate.linkedinUrl, candidate.sourceUrl].filter(Boolean);
        return `- ${candidate.name}${knownSources.length ? ` (known official ${platformOnly || 'public'} URLs: ${knownSources.join(', ')})` : ''}`;
      }).join('\n');
      const searchScope = platformOnly === 'Facebook'
        ? 'Search ONLY Facebook for each business. First locate its exact official public business Page with a site:facebook.com query, then inspect that Page for dated posts, reels, videos, offers, events, or announcements. Do not search or return TikTok, LinkedIn, websites, directories, or personal Facebook profiles. A result is valid only when its URL is on facebook.com or fb.com.'
        : platformOnly === 'TikTok'
          ? 'Search ONLY TikTok for each business. First locate its exact official public @profile with a site:tiktok.com query, then inspect that profile for dated videos in the requested window. Do not search or return Facebook, LinkedIn, websites, directories, or unrelated creators. A result is valid only when its URL is on tiktok.com.'
        : 'For EACH business listed above, individually search its official Facebook Page, TikTok profile, LinkedIn company/organization Updates, and official website for a dated post, reel, video, offer, event, launch, article, or campaign.';
      const emptyResultRule = platformOnly
        ? `Return an empty activities array only after checking ${platformOnly} separately for every listed business. Still return an official profile in profiles when one is found, even when it has no dated activity in this exact window.`
        : 'Return {"activities": []} only after checking Facebook, TikTok, LinkedIn, and the official website for every listed business and finding no dated activity in this exact window.';
      const fallbackEvidenceRule = platformOnly
        ? 'Prefer the direct post/video URL. Use an official Page/profile URL as activity evidence only when its visible search result contains that specific dated activity; a profile URL may always be returned separately in profiles but never counts as an activity by itself.'
        : "Prefer the direct content URL. When Facebook or LinkedIn exposes a clearly dated update only inside the exact business's official Page/organization Updates feed, that official Page/organization URL is acceptable fallback evidence; never use a generic profile page unless the rendered search result visibly contains that specific dated activity.";
      const sourceUrlDescription = platformOnly === 'Facebook'
        ? 'direct facebook.com or fb.com evidence URL'
        : platformOnly === 'TikTok'
          ? 'direct tiktok.com evidence URL'
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
      return `Search the live public web for activity posted by ONLY these exact businesses in ${country}:\n${businessList}\n\nDATE WINDOW: ${activityStartDate} through ${activityEndDate}, inclusive. Treat ${activityEndDate} as the current local calendar date. A source label such as "6h", "1d", "2d", or "5 days ago" is valid dated evidence: normalize it to YYYY-MM-DD by counting back from ${activityEndDate}.\n\n${searchScope} Check every requested source for every single business before moving on -- do not stop early after finding activity for only the first few names. ${fallbackEvidenceRule}\n\n${lastActivityRule}\n\nGROUNDING RULES: describe only facts visible in the public source, search-result extract, caption, title, description, or indexed transcript. For a video/reel, explain what it discusses or demonstrates only when its caption, description, visible text, or transcript supports that explanation. Never invent spoken words, scenes, results, offers, prices, audience reactions, or business actions. If detailed content is unavailable, keep summary and keyDetails empty instead of guessing.\n\nReturn ONLY valid JSON in this shape:\n{\n${profilesShape}  "activities": [\n    {\n      "competitorName": "exact name copied from the supplied list",\n      "date": "YYYY-MM-DD",\n      "contentType": "Video, Reel, Post, Article, Event, Offer, Ad, or Other",\n      "title": "exact visible title/headline, or a short factual label grounded in the source",\n      "activity": "one concise sentence stating what the business posted or announced",\n      "summary": "2-4 factual sentences explaining what the content is about, using only details visible in the source; empty string if unavailable",\n      "keyDetails": ["up to 6 concrete facts explicitly supported by the source"],\n      "sourceUrl": "${sourceUrlDescription}"\n    }\n  ],\n  "lastActivity": [\n    {\n      "competitorName": "exact name copied from the supplied list",\n      "date": "YYYY-MM-DD",\n      "activity": "one concise sentence stating what the business posted or announced",\n      "sourceUrl": "${sourceUrlDescription}"\n    }\n  ]\n}\n${emptyResultRule}`;
    };

    const activityLookupCandidates = candidates.slice(0, ACTIVITY_LOOKUP_LIST_CAP);
    const mergeActivities = (activities, allowedPlatforms = null) => {
      (Array.isArray(activities) ? activities : []).forEach((activity) => {
        if (allowedPlatforms && !allowedPlatforms.has(socialPlatformFromUrl(activity?.sourceUrl))) return;
        const candidate = mergedCandidates.get(competitorKey(activity?.competitorName));
        if (!candidate) return;
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
        if (allowedPlatforms && !allowedPlatforms.has(platform)) return;
        const candidate = mergedCandidates.get(competitorKey(entry?.competitorName));
        if (!candidate || candidate.recentActivities?.length) return;
        if (candidate.lastKnownActivity && candidate.lastKnownActivity.date >= date) return;
        candidate.lastKnownActivity = {
          date,
          activity: String(entry?.activity || '').trim().slice(0, 400) || 'Most recent verified public post found.',
          sourceUrl,
          platform,
        };
      });
    };
    const mergeSocialProfiles = (profiles, platform) => {
      const urlField = platform === 'Facebook' ? 'facebookUrl' : 'tiktokUrl';
      const validUrl = platform === 'Facebook' ? validFacebookUrl : validTikTokUrl;
      (Array.isArray(profiles) ? profiles : []).forEach((profile) => {
        const candidate = mergedCandidates.get(competitorKey(profile?.competitorName));
        const profileUrl = String(profile?.profileUrl || '').trim().slice(0, 300);
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
          new Set(['Facebook', 'TikTok']),
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
      competitorKey(candidate.name),
      { facebookUrl: candidate.facebookUrl, tiktokUrl: candidate.tiktokUrl },
    ]));
    const socialSearches = await Promise.allSettled(['Facebook', 'TikTok'].map(async (platform) => {
      const missingPlatform = activityLookupCandidates.filter((candidate) => (
        !(candidate.recentActivities || []).some((activity) => activity.platform === platform)
      ));
      if (!missingPlatform.length) return { platform, parsed: null };
      const response = await generateOpenRouterWebSearch({
        prompt: buildActivityPrompt(missingPlatform, { platformOnly: platform }),
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

    // The first direct pass can only use URLs known during discovery. If a
    // platform-only search just found a missing official URL, immediately use
    // it for one direct pass so indexed LinkedIn results are no longer the end
    // of the pipeline.
    if (isApifySocialActivityConfigured()) {
      const newlyAddressable = activityLookupCandidates.filter((candidate) => {
        const initial = initialSocialUrls.get(competitorKey(candidate.name)) || {};
        return (!initial.facebookUrl && candidate.facebookUrl)
          || (!initial.tiktokUrl && candidate.tiktokUrl);
      });
      if (newlyAddressable.length) {
        try {
          mergeActivities(
            await fetchApifySocialActivity({
              candidates: newlyAddressable,
              startDate: activityStartDate,
              endDate: activityEndDate,
            }),
            new Set(['Facebook', 'TikTok']),
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

  // Same real-HTTP-check pattern as _webBusinessSearch.js: a fabricated or
  // dead source URL is the actual failure mode worth guarding against here.
  // Activity URLs are checked sequentially within each worker, keeping total
  // outbound verification concurrency at the worker limit.
  const verified = (await mapWithConcurrency(candidates, URL_VERIFICATION_CONCURRENCY, async (item) => {
    // Public social networks commonly reject server-side HEAD/GET checks even
    // for real public pages. These URLs already came from grounded search, so
    // validate their exact supported host/shape instead of dropping them on a
    // platform anti-bot response. Ordinary web sources still require HTTP.
    if (!isSupportedPublicSocialUrl(item.sourceUrl) && !(await urlIsReachable(item.sourceUrl))) return null;
    const activityChecks = [];
    for (const activity of item.recentActivities || []) {
      if (isSupportedPublicSocialUrl(activity.sourceUrl) || await urlIsReachable(activity.sourceUrl)) activityChecks.push(activity);
    }
    let lastKnownActivity = null;
    if (item.lastKnownActivity
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
    const [tiktokUrl, linkedinUrl] = await Promise.all([
      verifiedSocialUrl(item.tiktokUrl),
      verifiedSocialUrl(item.linkedinUrl),
    ]);
    const facebookUrl = item.facebookUrl || derivedFacebookPageUrl(activityChecks) || '';
    return hasActivityWindow ? { ...item, facebookUrl, tiktokUrl, linkedinUrl, recentActivities: activityChecks.filter(Boolean), lastKnownActivity } : { name: item.name, matchReason: item.matchReason, positioning: item.positioning, facebookUrl, tiktokUrl, linkedinUrl, sourceUrl: item.sourceUrl };
  })).filter(Boolean);

  return {
    isSpecificEntity: !!discoveryParsed?.isSpecificEntity,
    entitySummary: String(discoveryParsed?.entitySummary || '').trim().slice(0, 400),
    competitors: verified,
  };
}
