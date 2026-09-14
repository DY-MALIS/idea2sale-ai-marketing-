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
        { name: 'Real School A', positioning: 'Premium pricing', linkedinUrl: 'https://www.linkedin.com/school/real-school-a/', sourceUrl: 'https://real-school-a.example.com' },
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
    { name: 'Real School A', matchReason: '', positioning: 'Premium pricing', linkedinUrl: 'https://www.linkedin.com/school/real-school-a/', sourceUrl: 'https://real-school-a.example.com' },
  ]);
});

it('rejects personal LinkedIn profiles while keeping verified competitors', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      competitors: [{
        name: 'Competitor A',
        positioning: '',
        linkedinUrl: 'https://www.linkedin.com/in/a-person/',
        sourceUrl: 'https://competitor.example.com',
      }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'Competitor A' });

  expect(result.competitors[0].linkedinUrl).toBe('');
});

it('searches complementary source groups and merges duplicate competitors', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{ name: 'Academy A', matchReason: 'Same courses and city', positioning: '', sourceUrl: 'https://academy-a.example.com' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{ name: 'Academy A', positioning: 'Professional training', linkedinUrl: 'https://www.linkedin.com/company/academy-a/', sourceUrl: 'https://directory.example.com/academy-a' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{ name: 'Academy B', matchReason: 'Same audience and training category', positioning: '', sourceUrl: 'https://academy-b.example.com' }] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'business training' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
  expect(result.competitors).toHaveLength(2);
  expect(result.competitors[0]).toMatchObject({
    name: 'Academy A',
    matchReason: 'Same courses and city',
    positioning: 'Professional training',
    linkedinUrl: 'https://www.linkedin.com/company/academy-a/',
  });
  expect(result.competitors[1].name).toBe('Academy B');
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

it('keeps only reachable, explicitly dated activity inside the requested 7-day window', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      isSpecificEntity: true,
      entitySummary: '',
      competitors: [{
        name: 'Competitor A',
        positioning: '',
        sourceUrl: 'https://competitor.example.com',
        recentActivities: [
          { date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current' },
          { date: '2026-09-07', activity: 'Published an old offer', sourceUrl: 'https://competitor.example.com/old' },
          { date: '2026-09-13', activity: 'Claim with a dead source', sourceUrl: 'https://dead.example.com/post' },
          { date: '', activity: 'Undated claim', sourceUrl: 'https://competitor.example.com/undated' },
        ],
      }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: !String(url).includes('dead.example.com'),
    status: String(url).includes('dead.example.com') ? 404 : 200,
  })));

  const result = await researchCompetitors({
    query: 'Competitor A',
    activityStartDate: '2026-09-08',
    activityEndDate: '2026-09-14',
  });

  expect(result.competitors[0].recentActivities).toEqual([
    { date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current' },
  ]);
});
