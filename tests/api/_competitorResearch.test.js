import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webSearch: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));

import { researchCompetitors } from '../../api/_competitorResearch.js';

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('returns only competitors whose source URL is real and reachable', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      isSpecificEntity: true,
      entitySummary: 'DGACADEMY is an English-language school in Phnom Penh.',
      competitors: [
        { name: 'Real School A', positioning: 'Premium pricing', sourceUrl: 'https://real-school-a.example.com' },
        { name: 'Fake School B', positioning: 'Made up', sourceUrl: 'https://dead-domain.example.com' },
      ],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => (
    String(url).includes('real-school-a') ? { ok: true, status: 200 } : { ok: false, status: 404 }
  )));

  const result = await researchCompetitors({ query: 'DGACADEMY' });

  expect(result.isSpecificEntity).toBe(true);
  expect(result.entitySummary).toContain('DGACADEMY');
  expect(result.competitors).toEqual([
    { name: 'Real School A', positioning: 'Premium pricing', sourceUrl: 'https://real-school-a.example.com' },
  ]);
});

it('never fabricates a competitor -- returns an empty list when the model finds none', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({ isSpecificEntity: false, entitySummary: '', competitors: [] }),
  });
  vi.stubGlobal('fetch', vi.fn());

  const result = await researchCompetitors({ query: 'a totally obscure niche business' });

  expect(result.competitors).toEqual([]);
  expect(result.isSpecificEntity).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('drops a competitor entry missing a source URL instead of keeping it unverified', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      isSpecificEntity: true,
      entitySummary: '',
      competitors: [{ name: 'No Source Co', positioning: '', sourceUrl: '' }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn());

  const result = await researchCompetitors({ query: 'x' });

  expect(result.competitors).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
