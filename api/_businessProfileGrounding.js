import { extractWebsiteText } from './_websiteExtract.js';

// Re-read every public link saved by this account before customer or competitor
// discovery. A social login wall is recorded as unreadable, never as evidence.
export async function readBusinessProfileSources(profile, extract = extractWebsiteText) {
  const candidates = [
    ['Website', profile?.websiteUrl],
    ['Facebook', profile?.facebookPageUrl],
    ['LinkedIn', profile?.linkedinUrl],
  ];
  const seen = new Set();
  const links = candidates.flatMap(([label, value]) => {
    const url = String(value || '').trim().slice(0, 300);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return [];
    seen.add(url);
    return [{ label, url }];
  });
  const results = await Promise.all(links.map(async ({ label, url }) => {
    try {
      const page = await extract({ url });
      const content = String(page?.text || '').replace(/\s+/g, ' ').trim();
      const title = String(page?.title || '').trim();
      const loginWall = /(?:facebook|linkedin).*(?:log in|sign up)|(?:log in|sign up).*(?:facebook|linkedin)/i.test(title)
        || (content.length < 500 && /(?:log in to|sign in to|join) (?:facebook|linkedin)/i.test(content));
      if (content.length < 80 || loginWall) return { label, url, readable: false };
      return { label, url, readable: true, title: title.slice(0, 160), excerpt: content.slice(0, 900) };
    } catch {
      return { label, url, readable: false };
    }
  }));
  return {
    sources: results,
    evidence: results.filter((source) => source.readable).map((source) =>
      `${source.label}: ${source.url}\nTitle: ${source.title || 'not provided'}\nVisible text: ${source.excerpt}`,
    ).join('\n\n'),
  };
}
