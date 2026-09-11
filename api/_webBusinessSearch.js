// Cambodia-friendly, zero-signup alternative to Meta's Ad Library API (which
// cannot search ordinary Cambodian business ads) and Google Places (which
// requires a billing card). Reuses the OpenRouter key this app already has and
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

const jsonFromText = (text) => {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : text || '{}');
  } catch {
    return {};
  }
};

async function urlIsReachable(url, timeoutMs = 6000) {
  if (!/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (response.ok || (response.status >= 300 && response.status < 400)) return true;
    // Some servers reject HEAD (405/403) but would serve GET fine.
    if (response.status === 405 || response.status === 403) {
      const getResponse = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      return getResponse.ok;
    }
    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchBusinessesOnWeb({ searchTerms, country = 'Cambodia' }) {
  const prompt = `Search the live web for REAL small and mid-sized independent businesses in ${country} matching: "${searchTerms}".

Prioritize small, independent, locally-owned businesses (a single shop, cafe, clinic, or small chain) over large corporations, franchises of international brands, or big real estate/cosmetics conglomerates -- small businesses are far more likely to actually need affordable content/video production help. Prefer sources that list a phone number and address (local business directories, Google/Facebook Maps listings, the business's own contact page) over general news articles, so each result includes real contact details whenever possible.

When the search request provides a list of exact company or Facebook Page names, treat this as contact enrichment: search each named business individually, preserve its exact public name, and return only those named businesses (no unrelated suggestions). Check its official website/contact page and public social profiles for the contact fields below.

Only include a business if you found it in an actual search result. Never invent a business, address, phone number, or website. If a field genuinely was not in the search result, leave it as an empty string rather than guessing.

Also include, whenever you actually find them in a search result: the business's public contact email, its Telegram channel/contact name plus username or t.me link, and its Facebook Page/channel name and URL. Never guess or construct these -- leave any of them blank if not explicitly present in a search result.

Return ONLY a single valid JSON object, no markdown, in this exact shape:
{
  "businesses": [
    {
      "name": "exact business name as found",
      "businessType": "short category",
      "address": "address if found, else empty string",
      "phone": "phone number if found, else empty string",
      "email": "public contact email if found, else empty string",
      "telegram": "Telegram channel/contact username or t.me link if found, else empty string",
      "website": "website URL if found, else empty string",
      "facebookPageName": "exact Facebook Page/channel name if found, else empty string",
      "facebookPageUrl": "Facebook Page URL if found, else empty string",
      "sourceUrl": "the exact URL of the search result this business came from"
    }
  ]
}
If you find no real businesses, return {"businesses": []}.`;

  const { content } = await generateOpenRouterWebSearch({ prompt, maxResults: 10 });
  const parsed = jsonFromText(content);

  const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const candidates = (Array.isArray(parsed?.businesses) ? parsed.businesses : [])
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
      return {
        businessName: String(item?.name || '').trim().slice(0, 200),
        businessType: String(item?.businessType || 'Business').trim().slice(0, 120),
        address: String(item?.address || '').trim().slice(0, 300),
        phone: String(item?.phone || '').trim().slice(0, 60),
        email: emailMatch?.[0] || '',
        telegram: isTelegramLink || isTelegramUsername || isTelegramDisplayName ? telegram : '',
        website: String(item?.website || '').trim().slice(0, 300),
        facebookPageName: String(item?.facebookPageName || '').trim().slice(0, 200),
        facebookPageUrl: /^https:\/\/(?:(?:www|m)\.)?(?:facebook\.com|fb\.com)\//i.test(facebookPageUrl) ? facebookPageUrl : '',
        sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 300),
      };
    })
    .filter((item) => item.businessName)
    .slice(0, 12);

  const verified = await Promise.all(candidates.map(async (item) => {
    const checkUrl = item.sourceUrl || item.website;
    const reachable = checkUrl ? await urlIsReachable(checkUrl) : false;
    return reachable ? item : null;
  }));

  return verified.filter(Boolean);
}
