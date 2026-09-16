// Cambodia-friendly public-web business discovery that does not require a
// separate directory or places API account. Reuses the OpenRouter key this app already has and
// grounds results in live web search instead of asking the model to guess --
// see generateOpenRouterWebSearch in _openrouter.js.
//
// OpenRouter's web-search citation annotations (url_citation) turned out to
// only reliably attach to a single inline citation in free-flowing prose --
// live testing showed they come back empty for bulk/structured JSON output
// even when the model's answers were clearly real, current, and web-sourced
// (specific real addresses/phone numbers for actual Cambodian businesses), so
// requiring an annotation match would silently reject genuine results. Instead,
// every claimed source/website URL is verified with a real HTTP request here --
// that catches the actual failure mode worth guarding against (a fabricated,
// unreachable domain) without discarding real results over an unrelated
// annotation-formatting quirk.
import { generateOpenRouterWebSearch } from './_openrouter.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BUSINESS_CANDIDATES = 75;
const URL_VERIFICATION_CONCURRENCY = 8;
const MAX_REDIRECTS = 5;

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

const isPublicIpAddress = (address) => {
  const normalized = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const version = isIP(normalized);
  if (version === 4) {
    const octets = normalized.split('.').map(Number);
    const [a, b, c] = octets;
    return !(
      a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 168)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224
    );
  }
  if (version === 6) {
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return isPublicIpAddress(mapped);
      const words = mapped.split(':');
      if (words.length === 2 && words.every((word) => /^[0-9a-f]{1,4}$/i.test(word))) {
        const high = Number.parseInt(words[0], 16);
        const low = Number.parseInt(words[1], 16);
        return isPublicIpAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
      }
      return false;
    }
    const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
    return !(
      normalized === '::'
      || normalized === '::1'
      || (first >= 0xfc00 && first <= 0xfdff)
      || (first >= 0xfe80 && first <= 0xfebf)
      || first >= 0xff00
      || normalized.startsWith('2001:db8:')
    );
  }
  return false;
};

export async function isPublicHttpUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
  if ((parsed.protocol === 'http:' && parsed.port && parsed.port !== '80')
    || (parsed.protocol === 'https:' && parsed.port && parsed.port !== '443')) return false;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname.endsWith('.home.arpa')) return false;
  if (isIP(hostname)) return isPublicIpAddress(hostname);
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => isPublicIpAddress(address));
  } catch {
    return false;
  }
}

const fetchValidatedUrl = async (initialUrl, method, signal) => {
  let currentUrl;
  try {
    currentUrl = new URL(initialUrl);
  } catch {
    return null;
  }
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (!(await isPublicHttpUrl(currentUrl.href))) return null;
    const response = await fetch(currentUrl, { method, redirect: 'manual', signal });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers?.get?.('location');
    if (!location || redirects === MAX_REDIRECTS) return null;
    try {
      currentUrl = new URL(location, currentUrl);
    } catch {
      return null;
    }
  }
  return null;
};

export async function urlIsReachable(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchValidatedUrl(url, 'HEAD', controller.signal);
    if (!response) return false;
    if (response.ok) return true;
    // Some servers reject HEAD (405/403) but would serve GET fine.
    if (response.status === 405 || response.status === 403) {
      const getResponse = await fetchValidatedUrl(url, 'GET', controller.signal);
      return !!getResponse?.ok;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchBusinessesOnWeb({ searchTerms, searchObjective = '', requiredSignal = '', entityScope = 'businesses', country = 'Cambodia', activityStartDate = '', activityEndDate = '' }) {
  const activityWindow = /^\d{4}-\d{2}-\d{2}$/.test(activityStartDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(activityEndDate)
    ? `\nFor each business, also search for public activity published from ${activityStartDate} through ${activityEndDate}, inclusive. An activity must have an explicit publication date and a direct public source URL. Do not treat undated content, a homepage, general positioning, or an inference as activity in this date window. If none is found, return an empty recentActivities array.`
    : '';
  const requiredSignalInstruction = requiredSignal === 'hiring'
    ? `\nHIRING EVIDENCE IS REQUIRED: Only return a business when a current public job vacancy, recruitment announcement, careers-page opening, or dated hiring post was found from ${activityStartDate} through ${activityEndDate}. Put that hiring evidence in recentActivities with its exact job title/type, date, and direct source URL. Exclude undated, expired, inferred, or generic "this company may hire" claims. The result must identify the employer/company name, not only a job title or recruitment agency.`
    : '';
  const workerScopeInstruction = entityScope === 'workers'
    ? `\nWORKER/TRADE SEARCH: Find real publicly listed tradespeople, freelancers, contractor teams, service businesses, and people publicly advertising that they are available for work in the exact requested trade. Examples include construction contractors, house builders, painters, electricians, plumbers, welders, mechanics, cleaners, drivers, and other requested skills. Preserve the exact trade/job category. A personal name is allowed only when it appears in a public professional/service directory, public portfolio, public business Page, or explicit public work-availability post. Never search private profiles, infer that someone needs work, or expose non-public personal data.`
    : '';
  const searchFocuses = [
    'Prioritize Google/Apple map listings and local business directories. Search city, district, province, and nearby-area variations.',
    'Prioritize official websites and contact pages. Search English, Khmer/local-language spellings, abbreviations, and transliterations.',
    'Prioritize real Facebook business Pages, Instagram business profiles, LinkedIn organization pages, and other public business social profiles. Never use personal profiles.',
    'Prioritize industry associations, marketplaces, review sites, category lists, event/vendor directories, and credible local news that may reveal businesses missed by map and official-site searches.',
  ];
  const buildPrompt = (focus) => `Search the live web for REAL businesses and organizations in ${country} matching the user's exact request: "${searchTerms}".
${activityWindow}
${requiredSignalInstruction}
${workerScopeInstruction}

SEARCH PASS FOCUS: ${focus}
SCAN OBJECTIVE: ${searchObjective || 'Find real public business prospects that match the request.'}

Interpret the request flexibly and preserve its intent:
- A specific company/Page/organization name means find and enrich that exact entity.
- A customer type or business category (restaurants, clinics, schools, factories, hotels, NGOs, retailers, professionals, etc.) means find real organizations in that category.
- A product/service or problem (needs video content, wants AI automation, hiring sales staff, opening a new branch, etc.) means find real organizations with public evidence or a strong category fit for that need.
- A location, size, language, industry, or other qualifier must narrow the results exactly as requested.
- A broad market request may include companies, shops, institutions, associations, nonprofits, and other legitimate organizations; do not arbitrarily force every request into only shops/cafes/clinics.
- A trade/worker request may include an individual public service provider, freelancer, contractor team, or job seeker with an explicit public work-availability listing; label which kind it is.
- Never replace the user's requested category with a different category merely because it may be easier to find.

When the request does not specify company size, prioritize small and mid-sized independent organizations because they are more realistic prospects, but still include larger companies when they directly match the requested customer type. Prefer sources that list a phone number and address (local business directories, Google/Facebook Maps listings, the business's own contact page) over general news articles, so each result includes real contact details whenever possible.

When the search request provides a list of exact company, Facebook Page, or LinkedIn organization names, treat this as contact enrichment: search each named business individually, preserve its exact public name, and return only those named businesses (no unrelated suggestions). Check its official website/contact page and public social profiles for the contact fields below.

Only include a business if you found it in an actual search result. Never invent a business, address, phone number, or website. If a field genuinely was not in the search result, leave it as an empty string rather than guessing.

Also include, whenever you actually find them in a search result: the business's public contact email, its Telegram channel/contact name plus username or t.me link, its Facebook Page/channel name and URL, and its official LinkedIn company/school page URL. Search LinkedIn organization pages as an additional competitor source, but never collect personal LinkedIn profiles. Never guess or construct these -- leave any of them blank if not explicitly present in a search result.

Return ONLY a single valid JSON object, no markdown, in this exact shape:
{
  "businesses": [
    {
      "name": "exact business name as found",
      "entityKind": "company, contractor_team, service_provider, freelancer, or job_seeker",
      "serviceOrJobType": "exact trade, skill, service, or type of work requested/offered",
      "businessType": "short category",
      "address": "address if found, else empty string",
      "phone": "phone number if found, else empty string",
      "email": "public contact email if found, else empty string",
      "telegram": "Telegram channel/contact username or t.me link if found, else empty string",
      "website": "website URL if found, else empty string",
      "facebookPageName": "exact Facebook Page/channel name if found, else empty string",
      "facebookPageUrl": "Facebook Page URL if found, else empty string",
      "linkedinUrl": "official LinkedIn company/school page URL if found, else empty string",
      "recentActivities": [
        { "date": "YYYY-MM-DD", "activity": "specific public post, ad, offer, event, campaign, or hiring announcement", "jobTitle": "exact advertised job title when this is a hiring result, else empty string", "sourceUrl": "direct public URL proving this activity and date" }
      ],
      "sourceUrl": "the exact URL of the search result this business came from"
    }
  ]
}
If you find no real businesses, return {"businesses": []}.`;

  // One web-search response tends to surface only the most visible few
  // businesses. Run complementary passes concurrently, then merge them, so
  // smaller local businesses and local-language results are not crowded out.
  const settledSearches = await Promise.allSettled(searchFocuses.map((focus) => (
    generateOpenRouterWebSearch({ prompt: buildPrompt(focus), maxResults: 20 })
  )));
  const parsedResults = settledSearches
    .filter((result) => result.status === 'fulfilled')
    .map((result) => jsonFromText(result.value.content));
  if (!parsedResults.length) {
    const firstFailure = settledSearches.find((result) => result.status === 'rejected');
    throw firstFailure?.reason || new Error('Web business search failed.');
  }

  const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const candidateMap = new Map();
  parsedResults.flatMap((parsed) => (Array.isArray(parsed?.businesses) ? parsed.businesses : []))
    .map((item) => {
      const email = String(item?.email || '').replace(/^mailto:/i, '').trim().slice(0, 200);
      const emailMatch = email.match(EMAIL_PATTERN);
      const telegram = String(item?.telegram || '').trim().slice(0, 120);
      const isTelegramLink = /^https?:\/\/(?:www\.)?t\.me\/(?:\+)?[A-Za-z0-9_-]{4,}(?:\?[^\s]*)?$/i.test(telegram);
      const isTelegramUsername = /^@[A-Za-z0-9_]{4,}$/i.test(telegram);
      // Keep an explicitly sourced display/channel name too. The UI renders it
      // as plain text unless it is an @username or a t.me link.
      const isTelegramDisplayName = telegram.length >= 2
        && !/^https?:\/\//i.test(telegram)
        && !/[\u0000-\u001F\u007F<>]/u.test(telegram);
      const facebookPageUrl = String(item?.facebookPageUrl || '').trim().slice(0, 300);
      const linkedinUrl = String(item?.linkedinUrl || '').trim().slice(0, 300);
      const recentActivities = (Array.isArray(item?.recentActivities) ? item.recentActivities : [])
        .map((activity) => ({
          date: String(activity?.date || '').trim(),
          activity: String(activity?.activity || '').trim().slice(0, 400),
          jobTitle: String(activity?.jobTitle || '').trim().slice(0, 160),
          sourceUrl: String(activity?.sourceUrl || '').trim().slice(0, 300),
        }))
        .filter((activity) => (
          /^\d{4}-\d{2}-\d{2}$/.test(activity.date)
          && activity.date >= activityStartDate
          && activity.date <= activityEndDate
          && activity.activity
          && /^https?:\/\//i.test(activity.sourceUrl)
        ))
        .slice(0, 5);
      return {
        businessName: String(item?.name || '').trim().slice(0, 200),
        entityKind: ['company', 'contractor_team', 'service_provider', 'freelancer', 'job_seeker'].includes(String(item?.entityKind || '').trim())
          ? String(item.entityKind).trim()
          : 'company',
        serviceOrJobType: String(item?.serviceOrJobType || item?.businessType || '').trim().slice(0, 160),
        businessType: String(item?.businessType || 'Business').trim().slice(0, 120),
        address: String(item?.address || '').trim().slice(0, 300),
        phone: String(item?.phone || '').trim().slice(0, 60),
        email: emailMatch?.[0] || '',
        telegram: isTelegramLink || isTelegramUsername || isTelegramDisplayName ? telegram : '',
        website: String(item?.website || '').trim().slice(0, 300),
        facebookPageName: String(item?.facebookPageName || '').trim().slice(0, 200),
        facebookPageUrl: /^https:\/\/(?:(?:www|m)\.)?(?:facebook\.com|fb\.com)\//i.test(facebookPageUrl) ? facebookPageUrl : '',
        linkedinUrl: /^https:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/(?:company|school|showcase)\//i.test(linkedinUrl) ? linkedinUrl : '',
        ...(activityWindow ? { recentActivities } : {}),
        sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 300),
      };
    })
    .filter((item) => item.businessName)
    .forEach((item) => {
      const key = item.businessName.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      if (!key) return;
      const existing = candidateMap.get(key);
      if (!existing) {
        candidateMap.set(key, item);
        return;
      }
      const recentActivities = [...(existing.recentActivities || []), ...(item.recentActivities || [])]
        .filter((activity, index, all) => all.findIndex((other) => other.date === activity.date && other.sourceUrl === activity.sourceUrl) === index)
        .slice(0, 5);
      candidateMap.set(key, {
        ...existing,
        businessType: existing.businessType !== 'Business' ? existing.businessType : item.businessType,
        entityKind: existing.entityKind !== 'company' ? existing.entityKind : item.entityKind,
        serviceOrJobType: existing.serviceOrJobType || item.serviceOrJobType,
        address: existing.address || item.address,
        phone: existing.phone || item.phone,
        email: existing.email || item.email,
        telegram: existing.telegram || item.telegram,
        website: existing.website || item.website,
        facebookPageName: existing.facebookPageName || item.facebookPageName,
        facebookPageUrl: existing.facebookPageUrl || item.facebookPageUrl,
        linkedinUrl: existing.linkedinUrl || item.linkedinUrl,
        sourceUrl: existing.sourceUrl || item.sourceUrl,
        ...(activityWindow ? { recentActivities } : {}),
      });
    });
  // Bound and throttle verification so a large/malformed model response cannot
  // exhaust sockets or the serverless invocation. Activity checks stay inside
  // the same worker and run sequentially.
  const candidates = [...candidateMap.values()].slice(0, MAX_BUSINESS_CANDIDATES);

  const verified = await mapWithConcurrency(candidates, URL_VERIFICATION_CONCURRENCY, async (item) => {
    const checkUrl = item.sourceUrl || item.website;
    const reachable = checkUrl ? await urlIsReachable(checkUrl) : false;
    if (!reachable) return null;
    const activityChecks = [];
    for (const activity of item.recentActivities || []) {
      if (await urlIsReachable(activity.sourceUrl)) activityChecks.push(activity);
    }
    return activityWindow ? { ...item, recentActivities: activityChecks } : item;
  });

  const verifiedBusinesses = verified.filter(Boolean);
  return requiredSignal === 'hiring'
    ? verifiedBusinesses.filter((business) => (business.recentActivities || []).length > 0)
    : verifiedBusinesses;
}
