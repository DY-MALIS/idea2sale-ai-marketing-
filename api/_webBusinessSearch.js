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
  const prompt = `Search the live web for REAL businesses in ${country} matching: "${searchTerms}".

Only include a business if you found it in an actual search result (a business directory listing, its own website, a news article, a review site, a Facebook/Google Maps listing, etc). Never invent a business, address, phone number, or website.

Return ONLY a single valid JSON object, no markdown, in this exact shape:
{
  "businesses": [
    {
      "name": "exact business name as found",
      "businessType": "short category",
      "address": "address if found, else empty string",
      "phone": "phone number if found, else empty string",
      "website": "website URL if found, else empty string",
      "sourceUrl": "the exact URL of the search result this business came from"
    }
  ]
}
If you find no real businesses, return {"businesses": []}.`;

  const { content } = await generateOpenRouterWebSearch({ prompt, maxResults: 10 });
  const parsed = jsonFromText(content);

  const candidates = (Array.isArray(parsed?.businesses) ? parsed.businesses : [])
    .map((item) => ({
      businessName: String(item?.name || '').trim().slice(0, 200),
      businessType: String(item?.businessType || 'Business').trim().slice(0, 120),
      address: String(item?.address || '').trim().slice(0, 300),
      phone: String(item?.phone || '').trim().slice(0, 60),
      website: String(item?.website || '').trim().slice(0, 300),
      sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 300),
    }))
    .filter((item) => item.businessName)
    .slice(0, 12);

  const verified = await Promise.all(candidates.map(async (item) => {
    const checkUrl = item.sourceUrl || item.website;
    const reachable = checkUrl ? await urlIsReachable(checkUrl) : false;
    return reachable ? item : null;
  }));

  return verified.filter(Boolean);
}
