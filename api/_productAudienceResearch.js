import { generateOpenRouterWebSearch } from './_openrouter.js';
import { urlIsReachable } from './_webBusinessSearch.js';
import { isSupportedPublicSocialUrl } from './_socialUrls.js';

const parseJson = (value) => {
  try {
    const text = String(value || '');
    const match = text.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : text);
  } catch {
    return {};
  }
};

export const productAudienceCandidates = (content) => {
  const parsed = parseJson(content);
  return (Array.isArray(parsed?.segments) ? parsed.segments : [])
    .map((item) => ({
      market: String(item?.market || '').trim().slice(0, 160),
      need: String(item?.need || '').trim().slice(0, 300),
      whyRelevant: String(item?.whyRelevant || '').trim().slice(0, 400),
      channel: String(item?.channel || '').trim().slice(0, 160),
      sourceUrl: String(item?.sourceUrl || '').trim().slice(0, 500),
    }))
    .filter((item) => item.market && item.need && item.whyRelevant && /^https:\/\//i.test(item.sourceUrl))
    .filter((item, index, all) => all.findIndex((other) => other.market.toLocaleLowerCase() === item.market.toLocaleLowerCase() && other.sourceUrl === item.sourceUrl) === index)
    .slice(0, 8);
};

export async function researchProductAudience({ product, country }) {
  const response = await generateOpenRouterWebSearch({
    maxResults: 12,
    prompt: `Research potential customer markets for the product or service category described here: "${product}". Target market: ${country}.

Find public evidence for distinct buyer groups, needs, and channels relevant to this category. Prefer local sources. Use credible market research, public retail/category listings, public business Pages, and public posts. A source must directly support the stated category need or market context. Do not claim that any named individual bought the product, reveal private followers, or invent purchases. Do not return competing sellers as customers merely because they sell the same product. If local evidence is sparse, return fewer segments and say so through the empty array.

Return only valid JSON:
{"segments":[{"market":"specific potential buyer group or business market","need":"product-relevant need or buying motivation","whyRelevant":"what the public source shows, with inference clearly identified","channel":"where this segment can be reached publicly","sourceUrl":"direct public evidence URL"}]}`,
  });
  const candidates = productAudienceCandidates(response.content);
  const verified = [];
  for (const item of candidates) {
    if (isSupportedPublicSocialUrl(item.sourceUrl) || await urlIsReachable(item.sourceUrl)) verified.push(item);
  }
  return verified;
}
