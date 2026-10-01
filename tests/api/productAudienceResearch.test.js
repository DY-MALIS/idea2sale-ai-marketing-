import { describe, expect, it } from 'vitest';
import { productAudienceCandidates } from '../../api/_productAudienceResearch.js';

describe('productAudienceCandidates', () => {
  it('keeps sourced market segments and rejects unsupported entries', () => {
    const candidates = productAudienceCandidates(JSON.stringify({ segments: [
      { market: 'Gift shoppers', need: 'Small gift bundles', whyRelevant: 'A public gift listing includes this category.', channel: 'Retail stores', sourceUrl: 'https://example.com/gifts' },
      { market: 'Gift shoppers', need: 'Repeat', whyRelevant: 'Same source.', channel: 'Retail stores', sourceUrl: 'https://example.com/gifts' },
      { market: 'Unknown buyers', need: 'Unknown', whyRelevant: 'No evidence.', channel: 'Social', sourceUrl: '' },
    ] }));
    expect(candidates).toEqual([{ market: 'Gift shoppers', need: 'Small gift bundles', whyRelevant: 'A public gift listing includes this category.', channel: 'Retail stores', sourceUrl: 'https://example.com/gifts' }]);
  });
});
