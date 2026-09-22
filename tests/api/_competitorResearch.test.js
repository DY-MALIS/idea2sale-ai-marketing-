import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ webSearch: vi.fn(), lookup: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));

import { researchCompetitors } from '../../api/_competitorResearch.js';

beforeEach(() => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

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
        { name: 'Real School A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same English courses and city', positioning: 'Premium pricing', linkedinUrl: 'https://www.linkedin.com/school/real-school-a/', sourceUrl: 'https://real-school-a.example.com' },
        { name: 'Fake School B', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Made up', positioning: 'Made up', sourceUrl: 'https://dead-domain.example.com' },
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
    { name: 'Real School A', matchReason: 'Same English courses and city', positioning: 'Premium pricing', facebookUrl: '', tiktokUrl: '', linkedinUrl: 'https://www.linkedin.com/school/real-school-a/', sourceUrl: 'https://real-school-a.example.com' },
  ]);
});

it('rejects personal LinkedIn profiles while keeping verified competitors', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      competitors: [{
        name: 'Competitor A',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Same category, customers, and market',
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
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{ name: 'Academy A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same courses and city', positioning: '', sourceUrl: 'https://academy-a.example.com' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{ name: 'Academy A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same courses and city', positioning: 'Professional training', linkedinUrl: 'https://www.linkedin.com/company/academy-a/', sourceUrl: 'https://directory.example.com/academy-a' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{ name: 'Academy B', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same audience and training category', positioning: '', sourceUrl: 'https://academy-b.example.com' }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'business training' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(5);
  expect(result.competitors).toHaveLength(2);
  expect(result.competitors[0]).toMatchObject({
    name: 'Academy A',
    matchReason: 'Same courses and city',
    positioning: 'Professional training',
    linkedinUrl: 'https://www.linkedin.com/company/academy-a/',
  });
  expect(result.competitors[1].name).toBe('Academy B');
});

it('keeps more than twelve verified competitors when broad discovery finds them', async () => {
  const competitors = Array.from({ length: 18 }, (_, index) => ({
    name: `Verified Competitor ${index + 1}`,
    isDirectCompetitor: true,
    matchConfidence: 'high',
    matchReason: 'Same category, customers, and market',
    positioning: '',
    sourceUrl: `https://competitor-${index + 1}.example.com`,
  }));
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ competitors }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'broad local category' });

  expect(result.competitors).toHaveLength(18);
});

it('caps and throttles URL verification for oversized model responses', async () => {
  const competitors = Array.from({ length: 90 }, (_, index) => ({
    name: `Competitor ${index + 1}`,
    isDirectCompetitor: true,
    matchConfidence: 'high',
    matchReason: 'Same category, customers, and market',
    positioning: '',
    sourceUrl: `https://competitor-${index + 1}.example.com`,
  }));
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ competitors }) });
  let activeRequests = 0;
  let peakRequests = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    activeRequests += 1;
    peakRequests = Math.max(peakRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 1));
    activeRequests -= 1;
    return { ok: true, status: 200 };
  }));

  const result = await researchCompetitors({ query: 'oversized category', exhaustive: false });

  expect(result.competitors).toHaveLength(75);
  expect(fetch).toHaveBeenCalledTimes(75);
  expect(peakRequests).toBeLessThanOrEqual(8);
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
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Same category, customers, and market',
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
    { date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current', platform: 'Web' },
  ]);
});

it('runs a focused second-stage lookup and builds dated activity for discovered competitors', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [{
        name: 'Rival Cafe',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Serves the same cafe customers in Phnom Penh',
        positioning: '',
        sourceUrl: 'https://rival-cafe.example.com',
        recentActivities: [],
      }],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Rival Cafe', date: '2026-09-18', activity: 'Posted a weekend coffee offer', sourceUrl: 'https://www.facebook.com/rivalcafe/posts/123' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [
      { competitorName: 'Rival Cafe', date: '2026-09-17', activity: 'Announced a barista workshop', sourceUrl: 'https://www.linkedin.com/posts/rivalcafe_workshop-activity-789' },
    ] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [
      { competitorName: 'Rival Cafe', date: '2026-09-16', activity: 'Published a seasonal menu article', sourceUrl: 'https://rival-cafe.example.com/news/seasonal-menu' },
    ] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(8);
  expect(mocks.webSearch.mock.calls[5][0].prompt).toContain('Build a detailed factual activity report');
  expect(mocks.webSearch.mock.calls[5][0].prompt).toContain('Rival Cafe');
  expect(mocks.webSearch.mock.calls[5][0].prompt).toContain('FACEBOOK:');
  expect(mocks.webSearch.mock.calls[6][0].prompt).toContain('LINKEDIN:');
  expect(mocks.webSearch.mock.calls[7][0].prompt).toContain('OFFICIAL WEBSITE:');
  expect(mocks.webSearch.mock.calls[5][0].prompt).toContain('"6h", "1d", "2d"');
  expect(result.competitors[0].recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-18', platform: 'Facebook' }),
    expect.objectContaining({ date: '2026-09-17', platform: 'LinkedIn' }),
    expect.objectContaining({ date: '2026-09-16', platform: 'Web' }),
  ]);
});

it('retries an empty batch result by exact competitor name and accepts normalized relative-date evidence', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [{
      name: 'DataU Academy',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Provides competing professional AI training in Phnom Penh',
      positioning: '',
      linkedinUrl: 'https://kh.linkedin.com/company/datauacademy',
      sourceUrl: 'https://kh.linkedin.com/company/datauacademy',
      recentActivities: [],
    }] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ competitors: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [{
      competitorName: 'DataU Academy',
      date: '2026-09-22',
      contentType: 'Post',
      title: 'AI at Work toolkit for professionals',
      activity: 'Promoted a practical AI toolkit course for professionals',
      summary: 'The post presents reusable AI prompts and workflows for finance, HR, and operations professionals.',
      keyDetails: ['Self-paced course', 'Targets finance, HR, and operations roles'],
      sourceUrl: 'https://kh.linkedin.com/company/datauacademy',
    }] }) });
  vi.stubGlobal('fetch', vi.fn());

  const result = await researchCompetitors({
    query: 'AI training academies Phnom Penh',
    activityStartDate: '2026-09-16',
    activityEndDate: '2026-09-22',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(9);
  expect(mocks.webSearch.mock.calls[8][0].prompt).toContain('exact business "DataU Academy"');
  expect(mocks.webSearch.mock.calls[8][0].prompt).toContain('Relative labels such as "6h"');
  expect(result.competitors[0].recentActivities).toEqual([
    expect.objectContaining({
      date: '2026-09-22',
      platform: 'LinkedIn',
      contentType: 'Post',
      title: 'AI at Work toolkit for professionals',
      summary: expect.stringContaining('reusable AI prompts'),
      keyDetails: ['Self-paced course', 'Targets finance, HR, and operations roles'],
    }),
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it('searches Facebook, TikTok, and LinkedIn separately and labels social activity sources', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({
      competitors: [{
        name: 'Social Academy',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Offers the same business training in Cambodia',
        positioning: 'Practical training',
        facebookUrl: 'https://www.facebook.com/socialacademy',
        tiktokUrl: 'https://www.tiktok.com/@socialacademy',
        linkedinUrl: 'https://www.linkedin.com/company/socialacademy/',
        sourceUrl: 'https://socialacademy.example.com',
        recentActivities: [
          { date: '2026-09-18', activity: 'Posted a course promotion', sourceUrl: 'https://www.facebook.com/socialacademy/posts/123' },
          { date: '2026-09-17', activity: 'Published a short training video', sourceUrl: 'https://www.tiktok.com/@socialacademy/video/456' },
          { date: '2026-09-16', activity: 'Announced a workshop', sourceUrl: 'https://www.linkedin.com/posts/socialacademy_workshop-activity-789' },
        ],
      }],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: String(url).includes('socialacademy.example.com'),
    status: String(url).includes('socialacademy.example.com') ? 200 : 403,
  })));

  const result = await researchCompetitors({
    query: 'business training',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  const prompts = mocks.webSearch.mock.calls.map(([request]) => request.prompt).join('\n');
  expect(prompts).toContain('FACEBOOK PASS');
  expect(prompts).toContain('TIKTOK PASS');
  expect(prompts).toContain('LINKEDIN PASS');
  expect(result.competitors[0]).toMatchObject({
    facebookUrl: 'https://www.facebook.com/socialacademy',
    tiktokUrl: 'https://www.tiktok.com/@socialacademy',
    linkedinUrl: 'https://www.linkedin.com/company/socialacademy/',
    recentActivities: [
      expect.objectContaining({ platform: 'Facebook' }),
      expect.objectContaining({ platform: 'TikTok' }),
      expect.objectContaining({ platform: 'LinkedIn' }),
    ],
  });
});
