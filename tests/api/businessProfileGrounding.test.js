import { describe, expect, it, vi } from 'vitest';
import { readBusinessProfileSources } from '../../api/_businessProfileGrounding.js';

describe('business profile source grounding', () => {
  it('reads every saved link for the current profile before research', async () => {
    const extract = vi.fn(async ({ url }) => ({ title: url, text: `Public introduction for ${url}. `.repeat(4) }));
    const result = await readBusinessProfileSources({
      websiteUrl: 'https://example.com',
      facebookPageUrl: 'https://facebook.com/example',
      linkedinUrl: 'https://linkedin.com/company/example',
    }, extract);
    expect(extract).toHaveBeenCalledTimes(3);
    expect(result.sources).toHaveLength(3);
    expect(result.sources.every((source) => source.readable)).toBe(true);
    expect(result.evidence).toContain('https://linkedin.com/company/example');
  });

  it('still reads the single link supplied and excludes inaccessible content', async () => {
    const extract = vi.fn(async () => { throw new Error('login required'); });
    const result = await readBusinessProfileSources({ facebookPageUrl: 'https://facebook.com/cafe' }, extract);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.sources).toEqual([{ label: 'Facebook', url: 'https://facebook.com/cafe', readable: false }]);
    expect(result.evidence).toBe('');
  });
});
