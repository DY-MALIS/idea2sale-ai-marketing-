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

export { socialPlatformFromUrl };

const MAX_COMPETITOR_CANDIDATES = 75;
const URL_VERIFICATION_CONCURRENCY = 8;
const ACTIVITY_LOOKUP_BATCH_SIZE = 5;
const MAX_ACTIVITIES_PER_COMPETITOR = 14;
const ACTIVITY_SOURCE_FOCUSES = [
  'FACEBOOK: Search site:facebook.com on each official business Page for direct public post, reel, video, offer, event, promotion, or ad URLs. Do not return a Page homepage as activity evidence.',
  'LINKEDIN: Search site:linkedin.com/posts and public organization updates for direct dated posts by the exact company/school/showcase organization. Never use personal profiles.',
  'OFFICIAL WEBSITE: Search each business official website for dated news, blog posts, offers, events, launches, campaign pages, or press releases. Return the exact dated article/event URL, not the website homepage.',
];

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

export async function researchCompetitors({ query, country = 'Cambodia', activityStartDate = '', activityEndDate = '', exhaustive = true, targetCount = 15 }) {
  const requestedTargetCount = Math.min(50, Math.max(1, Math.round(Number(targetCount) || 15)));
  const hasActivityWindow = /^\d{4}-\d{2}-\d{2}$/.test(activityStartDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(activityEndDate)
  const activityInstruction = hasActivityWindow
    ? `\nAlso search for each competitor's public activity published from ${activityStartDate} through ${activityEndDate}, inclusive. Only include a specific post, ad, offer, event, or campaign when the public source explicitly supports both the activity and its publication date. Never turn undated content, general positioning, or inference into recent activity.`
    : '';
  const searchFocuses = [
    'Prioritize official company websites, Google/Apple map results, and local business directories. Search the exact category plus the target city, province, and country. Find the most visible direct competitors first.',
    'FACEBOOK PASS: Search site:facebook.com for real public business Pages and their dated public posts, reels, offers, ads, events, and promotions. Return the exact Page URL and direct post/reel URL. Never use personal profiles or private content.',
    'TIKTOK PASS: Search site:tiktok.com for official public business profiles and dated public videos from those businesses. Return the exact @profile URL and direct /video/ URL. Never guess a handle and never use an unrelated creator.',
    'LINKEDIN PASS: Search site:linkedin.com/company, site:linkedin.com/school, and public organization posts. Return the exact organization URL and direct public post URL. Never use personal profiles.',
    'Prioritize customer review platforms, industry associations, credible local news, comparison lists, event exhibitor lists, marketplaces, and professional directories to find direct competitors or dated activities missed by the platform passes.',
  ];
  const activeSearchFocuses = exhaustive ? searchFocuses : searchFocuses.slice(0, 1);
  const buildPrompt = (focus) => `Search the live web about "${query}" in ${country}.
${activityInstruction}

SEARCH PASS FOCUS: ${focus}

Step 1 -- Identify the target: determine whether "${query}" is the name of one specific real business/brand/organization, or a general product niche/category (e.g. "skincare", "women's fashion shop"). Base this only on what real search results show -- never guess.

Step 2 -- Find real competitors: search for REAL, named businesses. A business only counts as a competitor if it meets ALL of these:
  (a) Same core industry/category -- it sells the same or a directly substitutable product/service as the target (from Step 1) or the stated niche.
  (b) Overlapping customers -- it targets a similar customer segment in the same geographic market (${country}, and the same city/region when the target is a local business).
  (c) Currently active and real -- found via an actual, live search result (its own website, a business directory listing, a comparison article, a news mention, a real Facebook Page, or an official LinkedIn company/school page), not a defunct business or an unrelated mention of the same words.
  (d) Comparable scale -- prefer other small/independent or similarly-sized businesses over an unrelated large multinational conglomerate, unless the target itself is a large/national brand.
Every competitor you list MUST satisfy all four and come with a real source URL backing it. Explicitly exclude suppliers, distributors that do not sell a substitute, agencies serving the target, partners, customers, parent/sister companies, businesses that merely share a broad industry, and companies outside the real geographic/customer market. Rank the most important direct competitors first based on visible public market presence and relevance to the same customers, not on guessed revenue or private data. Return up to 20 strong matches actually found in this pass; never target a quota and never pad the list. Search alternate spellings and local-language names so legitimate local businesses are not missed. Never invent a competitor name and never list one you cannot support with a real source URL.
Every entry you return already met all four criteria above, so always set "isDirectCompetitor": true and "matchConfidence": "high" for it -- these are not separate judgment calls. If you are not fully confident a business satisfies all four, omit it entirely rather than listing it with a lower confidence; there is no "medium" or "low" tier, only include or exclude.

For each verified competitor, provide a short factual "matchReason" stating the exact overlapping product/service, customer group, and location supported by the search evidence. Search for its official Facebook Page, TikTok @profile, and LinkedIn organization page. Only return URLs explicitly found in live results; never return a personal profile and never construct a URL from the company name. For recentActivities, the sourceUrl must be the direct dated post/video/reel URL, not merely a profile or homepage. Only fill in "positioning" if the source actually supports it; otherwise leave it as an empty string rather than inferring.

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
      "recentActivities": [
        { "date": "YYYY-MM-DD", "activity": "specific public post, video, ad, offer, event, or campaign", "sourceUrl": "direct public URL proving this activity and date" }
      ],
      "sourceUrl": "the exact URL this came from"
    }
  ]
}
If nothing reliable was found, return {"isSpecificEntity": false, "entitySummary": "", "competitors": []}.`;

  const settledSearches = await Promise.allSettled(activeSearchFocuses.map((focus) => (
    generateOpenRouterWebSearch({ prompt: buildPrompt(focus), maxResults: 20 })
  )));
  const parsedResults = settledSearches
    .filter((result) => result.status === 'fulfilled')
    .map((result) => jsonFromText(result.value.content));

  if (!parsedResults.length) {
    const firstFailure = settledSearches.find((result) => result.status === 'rejected');
    throw firstFailure?.reason || new Error('Competitor search failed.');
  }

  const mergedCandidates = new Map();
  parsedResults.forEach((parsed) => {
    (Array.isArray(parsed?.competitors) ? parsed.competitors : []).forEach((item) => {
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
        ...(hasActivityWindow ? { recentActivities: normalizeRecentActivities(
          item?.recentActivities,
          activityStartDate,
          activityEndDate,
        ) } : {}),
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
      const activities = normalizeRecentActivities(
        [...(existing.recentActivities || []), ...(candidate.recentActivities || [])],
        activityStartDate,
        activityEndDate,
      );
      mergedCandidates.set(key, {
        ...existing,
        matchReason: existing.matchReason || candidate.matchReason,
        positioning: existing.positioning || candidate.positioning,
        facebookUrl: existing.facebookUrl || candidate.facebookUrl,
        tiktokUrl: existing.tiktokUrl || candidate.tiktokUrl,
        linkedinUrl: existing.linkedinUrl || candidate.linkedinUrl,
        ...(hasActivityWindow ? { recentActivities: activities } : {}),
      });
    });
  });
  // Keep broad discovery useful while bounding outbound requests so a large or
  // malformed model response cannot exhaust a serverless invocation.
  const candidates = [...mergedCandidates.values()].slice(0, MAX_COMPETITOR_CANDIDATES);

  // Discovery prompts often find the right competitors but return no dated
  // posts because they are also doing entity matching. Once the names are
  // known, run a focused second stage in small batches that searches the exact
  // seven-day window and maps every post back to an already-verified candidate.
  // This produces the day-by-day report without letting the activity search
  // introduce a new or invented competitor.
  if (hasActivityWindow && candidates.length) {
    const activityCandidates = candidates.slice(0, requestedTargetCount);
    const batches = [];
    for (let index = 0; index < activityCandidates.length; index += ACTIVITY_LOOKUP_BATCH_SIZE) {
      batches.push(activityCandidates.slice(index, index + ACTIVITY_LOOKUP_BATCH_SIZE));
    }
    const activitySearches = await Promise.allSettled(batches.flatMap((batch) => (
      ACTIVITY_SOURCE_FOCUSES.map((sourceFocus) => {
        const exactNames = batch.map((candidate) => candidate.name);
        const prompt = `Search the live public web for activity posted by ONLY these exact businesses in ${country}:\n${exactNames.map((name) => `- ${name}`).join('\n')}\n\nDATE WINDOW: ${activityStartDate} through ${activityEndDate}, inclusive. Treat ${activityEndDate} as the current local calendar date for this report. A source label such as "6h", "1d", "2d", or "5 days ago" is valid dated evidence: normalize it to YYYY-MM-DD by counting back from ${activityEndDate}.\n\nSOURCE-SPECIFIC PASS: ${sourceFocus}\n\nBuild a detailed factual activity report. Look across every day in the date window instead of stopping after one result. Include a post, video, reel, ad, promotion, offer, event, launch, article, or campaign only when a public result explicitly proves both the activity and its absolute or relative publication date. Prefer the direct content URL. When Facebook or LinkedIn exposes a clearly dated update only inside the exact business's official Page/organization Updates feed, the official Page/organization URL is acceptable evidence; never use a generic profile page unless the rendered search result visibly contains that specific dated activity.\n\nGROUNDING RULES: Describe only facts visible in the public source, search-result extract, caption, title, description, or indexed transcript. For a video/reel, explain what it discusses or demonstrates only when its caption, description, visible text, or transcript supports that explanation. Never invent spoken words, scenes, results, offers, prices, audience reactions, or business actions. If detailed content is unavailable, keep summary and keyDetails empty instead of guessing. Every keyDetails item must be a concrete source-backed fact.\n\nReturn ONLY valid JSON in this shape:\n{\n  "activities": [\n    {\n      "competitorName": "exact name copied from the supplied list",\n      "date": "YYYY-MM-DD",\n      "contentType": "Video, Reel, Post, Article, Event, Offer, Ad, or Other",\n      "title": "exact visible title/headline, or a short factual label grounded in the source",\n      "activity": "one concise sentence stating what the business posted or announced",\n      "summary": "2-4 factual sentences explaining what the content is about, using only details visible in the source; empty string if unavailable",\n      "keyDetails": ["up to 6 concrete facts explicitly supported by the source"],\n      "sourceUrl": "direct public evidence URL or the official organization Updates URL fallback described above"\n    }\n  ]\n}\nReturn {"activities": []} only when no explicitly dated public activity is found in the window.`;
        return generateOpenRouterWebSearch({ prompt, maxResults: 20 });
      })
    )));

    const mergeActivitySearches = (settledSearches) => {
      settledSearches.forEach((settled) => {
        if (settled.status !== 'fulfilled') return;
        const parsed = jsonFromText(settled.value?.content);
        (Array.isArray(parsed?.activities) ? parsed.activities : []).forEach((activity) => {
          const candidate = mergedCandidates.get(competitorKey(activity?.competitorName));
          if (!candidate) return;
          candidate.recentActivities = normalizeRecentActivities(
            [...(candidate.recentActivities || []), activity],
            activityStartDate,
            activityEndDate,
          );
        });
      });
    };
    mergeActivitySearches(activitySearches);

    // Batch searches can still spend all their result slots on the first few
    // names. Retry only the empty competitors one-by-one, across the requested
    // sources, so a busy official feed such as LinkedIn Updates is not hidden
    // just because it shared a batch with other companies.
    const emptyActivityCandidates = activityCandidates.filter((candidate) => !(candidate.recentActivities || []).length);
    const targetedSearches = await Promise.allSettled(emptyActivityCandidates.map((candidate) => {
      const knownSources = [candidate.facebookUrl, candidate.linkedinUrl, candidate.sourceUrl].filter(Boolean).join('\n- ');
      const prompt = `Find the public activity of the exact business "${candidate.name}" in ${country} from ${activityStartDate} through ${activityEndDate}, inclusive. Treat ${activityEndDate} as today's local date.\n\nSearch all three sources carefully:\n1. Facebook official Page posts, reels, videos, offers, promotions, and events.\n2. LinkedIn official company/school/showcase Updates and posts.\n3. The official website's dated news, blog, event, offer, launch, or campaign pages.\n${knownSources ? `\nKnown public URLs to verify first:\n- ${knownSources}\n` : ''}\nRelative labels such as "6h", "10h", "1d", "2d", or "6 days ago" are explicit date evidence. Convert them to YYYY-MM-DD by counting back from ${activityEndDate}; do not discard them merely because the source uses a relative label. Prefer a direct activity URL. If a clearly dated Facebook/LinkedIn update is rendered only within the exact official Page/organization Updates feed, its official Page URL is an acceptable fallback. Never report a generic page without a specific visible activity and date.\n\nDescribe only source-backed facts. For video/reel content, summarize what it discusses or demonstrates only from the visible caption, description, on-page text, or indexed transcript. Never invent dialogue, visuals, claims, offers, prices, outcomes, or business actions. If the source exposes no detail, leave summary and keyDetails empty.\n\nReturn ONLY valid JSON:\n{ "activities": [{ "competitorName": ${JSON.stringify(candidate.name)}, "date": "YYYY-MM-DD", "contentType": "Video, Reel, Post, Article, Event, Offer, Ad, or Other", "title": "source-grounded title or label", "activity": "what the business specifically posted or announced", "summary": "2-4 factual source-grounded sentences, or empty string", "keyDetails": ["up to 6 concrete source-backed facts"], "sourceUrl": "public evidence URL" }] }\nReturn {"activities": []} only after checking Facebook, LinkedIn, and the official website and finding no dated activity in this exact window.`;
      return generateOpenRouterWebSearch({ prompt, maxResults: 20 });
    }));
    mergeActivitySearches(targetedSearches);
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
    return hasActivityWindow ? { ...item, recentActivities: activityChecks.filter(Boolean) } : item;
  })).filter(Boolean);

  return {
    isSpecificEntity: parsedResults.some((parsed) => !!parsed?.isSpecificEntity),
    entitySummary: String(parsedResults.find((parsed) => String(parsed?.entitySummary || '').trim())?.entitySummary || '').trim().slice(0, 400),
    competitors: verified,
  };
}
