// Grounds competitor intelligence in live web search results instead of letting
// the main strategy prompt name competitors from the model's own memory --
// for a small/unfamiliar business name (e.g. a specific local company rather
// than a well-known brand) the model has no real knowledge of who it competes
// with, and asking it to guess produces plausible-sounding but fabricated
// names. This searches the live web first and only returns competitors that
// come from an actual, independently-checked source URL.
import { generateOpenRouterWebSearch } from './_openrouter.js';
import { urlIsReachable } from './_webBusinessSearch.js';

const MAX_COMPETITOR_CANDIDATES = 75;
const URL_VERIFICATION_CONCURRENCY = 8;

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

export const socialPlatformFromUrl = (value) => {
  try {
    const { hostname } = new URL(String(value || ''));
    const host = hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.com') return 'Facebook';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) return 'TikTok';
    if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) return 'LinkedIn';
  } catch {
    // Non-URLs are treated as ordinary web evidence and rejected downstream.
  }
  return 'Web';
};

const validFacebookUrl = (value) => /^https:\/\/(?:(?:www|m)\.)?(?:facebook\.com|fb\.com)\/(?!profile\.php(?:\?|$))[^\s]+/i.test(value);
const validTikTokUrl = (value) => /^https:\/\/(?:www\.)?tiktok\.com\/@[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(value);
const validLinkedInUrl = (value) => /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:company|school|showcase)\//i.test(value);
const validLinkedInPostUrl = (value) => /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:posts\/|feed\/update\/)/i.test(value);
const isSupportedPublicSocialUrl = (value) => (
  validFacebookUrl(value)
  || validTikTokUrl(value)
  || validLinkedInUrl(value)
  || validLinkedInPostUrl(value)
);

export async function researchCompetitors({ query, country = 'Cambodia', activityStartDate = '', activityEndDate = '', exhaustive = true }) {
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
        ...(hasActivityWindow ? { recentActivities: (Array.isArray(item?.recentActivities) ? item.recentActivities : [])
          .map((activity) => ({
            date: String(activity?.date || '').trim(),
            activity: String(activity?.activity || '').trim().slice(0, 400),
            sourceUrl: String(activity?.sourceUrl || '').trim().slice(0, 300),
            platform: socialPlatformFromUrl(activity?.sourceUrl),
          }))
          .filter((activity) => (
            /^\d{4}-\d{2}-\d{2}$/.test(activity.date)
            && activity.date >= activityStartDate
            && activity.date <= activityEndDate
            && activity.activity
            && /^https?:\/\//i.test(activity.sourceUrl)
          ))
          .slice(0, 5) } : {}),
      };
      if (!isDirectCompetitor || matchConfidence !== 'high' || !candidate.matchReason) return;
      if (!candidate.name || !/^https?:\/\//i.test(candidate.sourceUrl)) return;
      const key = candidate.name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      if (!key) return;
      const existing = mergedCandidates.get(key);
      if (!existing) {
        mergedCandidates.set(key, candidate);
        return;
      }
      const activities = [...(existing.recentActivities || []), ...(candidate.recentActivities || [])]
        .filter((activity, index, all) => all.findIndex((other) => other.date === activity.date && other.sourceUrl === activity.sourceUrl) === index)
        .slice(0, 5);
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
