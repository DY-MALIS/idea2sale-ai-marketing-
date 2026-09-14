// Grounds competitor intelligence in live web search results instead of letting
// the main strategy prompt name competitors from the model's own memory --
// for a small/unfamiliar business name (e.g. a specific local company rather
// than a well-known brand) the model has no real knowledge of who it competes
// with, and asking it to guess produces plausible-sounding but fabricated
// names. This searches the live web first and only returns competitors that
// come from an actual, independently-checked source URL.
import { generateOpenRouterWebSearch } from './_openrouter.js';
import { urlIsReachable } from './_webBusinessSearch.js';

const jsonFromText = (text) => {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : text || '{}');
  } catch {
    return {};
  }
};

export async function researchCompetitors({ query, country = 'Cambodia', activityStartDate = '', activityEndDate = '' }) {
  const hasActivityWindow = /^\d{4}-\d{2}-\d{2}$/.test(activityStartDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(activityEndDate)
  const activityInstruction = hasActivityWindow
    ? `\nAlso search for each competitor's public activity published from ${activityStartDate} through ${activityEndDate}, inclusive. Only include a specific post, ad, offer, event, or campaign when the public source explicitly supports both the activity and its publication date. Never turn undated content, general positioning, or inference into recent activity.`
    : '';
  const searchFocuses = [
    'Prioritize official company websites, local business directories, maps/listings, industry associations, and credible local news. Find the most visible direct competitors first.',
    'Prioritize official LinkedIn company/school/showcase pages and real Facebook business Pages. Use them to discover active organizations, but prefer an independently reachable website or directory URL as sourceUrl when available.',
    'Prioritize comparison/list articles, category searches, customer review platforms, and city/region-specific searches. Look for important direct competitors missed by the other source groups.',
  ];
  const buildPrompt = (focus) => `Search the live web about "${query}" in ${country}.
${activityInstruction}

SEARCH PASS FOCUS: ${focus}

Step 1 -- Identify the target: determine whether "${query}" is the name of one specific real business/brand/organization, or a general product niche/category (e.g. "skincare", "women's fashion shop"). Base this only on what real search results show -- never guess.

Step 2 -- Find real competitors: search for REAL, named businesses. A business only counts as a competitor if it meets ALL of these:
  (a) Same core industry/category -- it sells the same or a directly substitutable product/service as the target (from Step 1) or the stated niche.
  (b) Overlapping customers -- it targets a similar customer segment in the same geographic market (${country}, and the same city/region when the target is a local business).
  (c) Currently active and real -- found via an actual, live search result (its own website, a business directory listing, a comparison article, a news mention, a real Facebook Page, or an official LinkedIn company/school page), not a defunct business or an unrelated mention of the same words.
  (d) Comparable scale -- prefer other small/independent or similarly-sized businesses over an unrelated large multinational conglomerate, unless the target itself is a large/national brand.
Every competitor you list MUST satisfy all four and come with a real source URL backing it. Rank the most important direct competitors first based on visible public market presence and relevance to the same customers, not on guessed revenue or private data. Return up to 12 strong matches for this search pass. Never invent a competitor name and never list one you cannot support with a real source URL. If you cannot find any real, verifiable competitor meeting this bar, return an empty list -- do not guess or pad it with plausible-sounding names just to fill the list.

For each verified competitor, provide a short factual "matchReason" stating the exact overlapping product/service, customer group, and location supported by the search evidence. Search for its official LinkedIn organization page in addition to Facebook and web sources. Only return a LinkedIn company, school, or showcase URL explicitly found in live results; never return a personal profile and never construct a URL from the company name. Only fill in "positioning" if the source actually supports it; otherwise leave it as an empty string rather than inferring.

Return ONLY a single valid JSON object, no markdown:
{
  "isSpecificEntity": true or false,
  "entitySummary": "one factual sentence on what the target actually is/does, based only on search results, or an empty string if not found",
  "competitors": [
    {
      "name": "exact real name",
      "matchReason": "factual reason this is a direct competitor, grounded in the source",
      "positioning": "only if directly supported by the source, else empty string",
      "linkedinUrl": "official LinkedIn company/school/showcase page URL if found, else empty string",
      "recentActivities": [
        { "date": "YYYY-MM-DD", "activity": "specific public post, ad, offer, event, or campaign", "sourceUrl": "direct public URL proving this activity and date" }
      ],
      "sourceUrl": "the exact URL this came from"
    }
  ]
}
If nothing reliable was found, return {"isSpecificEntity": false, "entitySummary": "", "competitors": []}.`;

  const settledSearches = await Promise.allSettled(searchFocuses.map((focus) => (
    generateOpenRouterWebSearch({ prompt: buildPrompt(focus), maxResults: 12 })
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
      const linkedinUrl = String(item?.linkedinUrl || '').trim().slice(0, 300);
      const candidate = {
        name: String(item?.name || '').trim().slice(0, 200),
        matchReason: String(item?.matchReason || '').trim().slice(0, 500),
        positioning: String(item?.positioning || '').trim().slice(0, 300),
        linkedinUrl: /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:company|school|showcase)\//i.test(linkedinUrl) ? linkedinUrl : '',
        sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 300),
        ...(hasActivityWindow ? { recentActivities: (Array.isArray(item?.recentActivities) ? item.recentActivities : [])
          .map((activity) => ({
            date: String(activity?.date || '').trim(),
            activity: String(activity?.activity || '').trim().slice(0, 400),
            sourceUrl: String(activity?.sourceUrl || '').trim().slice(0, 300),
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
        linkedinUrl: existing.linkedinUrl || candidate.linkedinUrl,
        ...(hasActivityWindow ? { recentActivities: activities } : {}),
      });
    });
  });
  const candidates = [...mergedCandidates.values()].slice(0, 12);

  // Same real-HTTP-check pattern as _webBusinessSearch.js: a fabricated or
  // dead source URL is the actual failure mode worth guarding against here.
  const verified = (await Promise.all(candidates.map(async (item) => {
    if (!(await urlIsReachable(item.sourceUrl))) return null;
    const activityChecks = await Promise.all((item.recentActivities || []).map(async (activity) => (
      (await urlIsReachable(activity.sourceUrl)) ? activity : null
    )));
    return hasActivityWindow ? { ...item, recentActivities: activityChecks.filter(Boolean) } : item;
  }))).filter(Boolean);

  return {
    isSpecificEntity: parsedResults.some((parsed) => !!parsed?.isSpecificEntity),
    entitySummary: String(parsedResults.find((parsed) => String(parsed?.entitySummary || '').trim())?.entitySummary || '').trim().slice(0, 400),
    competitors: verified,
  };
}
