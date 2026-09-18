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

export async function researchMarketTrends({ query, country, startDate, endDate }) {
  const response = await generateOpenRouterWebSearch({
    maxResults: 12,
    prompt: `Search the live public web for rising market and social-content trends related to "${query}" in ${country}, published from ${startDate} through ${endDate}, inclusive.

Find concrete, recent waves: growing customer interests, repeated content themes, product/service demand, campaign formats, search or social topics, and notable changes in public behavior. Use public business pages, credible news, industry publications, public social posts, event pages, marketplaces, or research sources. Do not use private profiles, private groups, messages, or inferred personal data.

Every trend must have an explicit publication date inside the requested window and a direct public source URL proving the evidence. Omit undated, older, generic, or unsupported claims. Return at most 8 strong trends and never pad the list.

Return only valid JSON:
{
  "trends": [
    {
      "topic": "short trend name",
      "date": "YYYY-MM-DD",
      "evidence": "specific public evidence showing why this is rising or relevant",
      "opportunity": "one concrete marketing or video action a business can take",
      "sourceUrl": "direct public evidence URL"
    }
  ]
}`,
  });

  const parsed = jsonFromText(response.content);
  const candidates = (Array.isArray(parsed?.trends) ? parsed.trends : [])
    .map((trend) => ({
      topic: String(trend?.topic || '').trim().slice(0, 180),
      date: String(trend?.date || '').trim(),
      evidence: String(trend?.evidence || '').trim().slice(0, 500),
      opportunity: String(trend?.opportunity || '').trim().slice(0, 500),
      sourceUrl: String(trend?.sourceUrl || '').trim().slice(0, 500),
    }))
    .filter((trend) => (
      trend.topic
      && trend.evidence
      && trend.opportunity
      && /^\d{4}-\d{2}-\d{2}$/.test(trend.date)
      && trend.date >= startDate
      && trend.date <= endDate
      && /^https?:\/\//i.test(trend.sourceUrl)
    ))
    .filter((trend, index, all) => all.findIndex((other) => other.sourceUrl === trend.sourceUrl && other.topic === trend.topic) === index)
    .slice(0, 8);

  const verified = [];
  for (const trend of candidates) {
    if (await urlIsReachable(trend.sourceUrl)) verified.push(trend);
  }
  return verified;
}
