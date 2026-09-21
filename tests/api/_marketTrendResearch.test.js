import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  webSearch: vi.fn(),
  reachable: vi.fn(),
}));

vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));
vi.mock('../../api/_webBusinessSearch.js', () => ({ urlIsReachable: mocks.reachable }));

import { researchMarketTrends } from '../../api/_marketTrendResearch.js';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.reachable.mockResolvedValue(true);
});

it('keeps only reachable trends explicitly dated inside the requested week', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      trends: [
        { topic: 'Verified wave', date: '2026-09-18', evidence: 'Public evidence', opportunity: 'Create a demo', sourceUrl: 'https://example.com/verified' },
        { topic: 'Old wave', date: '2026-09-01', evidence: 'Old evidence', opportunity: 'Ignore it', sourceUrl: 'https://example.com/old' },
        { topic: 'Dead source', date: '2026-09-17', evidence: 'Unreachable evidence', opportunity: 'Ignore it', sourceUrl: 'https://example.com/dead' },
      ],
    }),
  });
  mocks.reachable.mockImplementation(async (url) => !url.endsWith('/dead'));

  const trends = await researchMarketTrends({
    query: 'skincare',
    country: 'Cambodia',
    startDate: '2026-09-12',
    endDate: '2026-09-18',
  });

  expect(trends).toEqual([expect.objectContaining({ topic: 'Verified wave', date: '2026-09-18' })]);
  expect(mocks.webSearch).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 12 }));
});

it('keeps a trend whose evidence is a Facebook post even when the reachability check fails', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      trends: [
        { topic: 'Social wave', date: '2026-09-18', evidence: 'Public post', opportunity: 'React to it', sourceUrl: 'https://www.facebook.com/somepage/posts/123' },
      ],
    }),
  });
  // Facebook returning an anti-bot response to a server-side check is the
  // real-world case this bypass guards against.
  mocks.reachable.mockResolvedValue(false);

  const trends = await researchMarketTrends({
    query: 'skincare',
    country: 'Cambodia',
    startDate: '2026-09-12',
    endDate: '2026-09-18',
  });

  expect(trends).toEqual([expect.objectContaining({ topic: 'Social wave' })]);
});
