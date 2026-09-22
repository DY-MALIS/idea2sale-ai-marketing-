import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  webSearch: vi.fn(),
  lookup: vi.fn(),
  isMetaAdLibraryConfigured: vi.fn(),
  fetchMetaAdLibraryActivity: vi.fn(),
}));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('../../api/_metaAdLibrary.js', () => ({
  isMetaAdLibraryConfigured: mocks.isMetaAdLibraryConfigured,
  fetchMetaAdLibraryActivity: mocks.fetchMetaAdLibraryActivity,
}));

import { researchCompetitors } from '../../api/_competitorResearch.js';

beforeEach(() => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  // Off by default so existing web-search-only tests are unaffected; tests
  // that care about the Meta Ad Library stage opt in explicitly.
  mocks.isMetaAdLibraryConfigured.mockReturnValue(false);
  mocks.fetchMetaAdLibraryActivity.mockResolvedValue([]);
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

  expect(mocks.webSearch).toHaveBeenCalledTimes(1);
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

it('sends one combined discovery search covering every source group and dedupes repeated entries', async () => {
  mocks.webSearch.mockResolvedValueOnce({
    content: JSON.stringify({
      competitors: [
        { name: 'Academy A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same courses and city', positioning: '', sourceUrl: 'https://academy-a.example.com' },
        { name: 'Academy A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same courses and city', positioning: 'Professional training', linkedinUrl: 'https://www.linkedin.com/company/academy-a/', sourceUrl: 'https://directory.example.com/academy-a' },
        { name: 'Academy B', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same audience and training category', positioning: '', sourceUrl: 'https://academy-b.example.com' },
      ],
    }),
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'business training' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(1);
  const [request] = mocks.webSearch.mock.calls[0];
  expect(request.prompt).toContain('FACEBOOK:');
  expect(request.prompt).toContain('TIKTOK:');
  expect(request.prompt).toContain('LINKEDIN:');
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

  const result = await researchCompetitors({ query: 'oversized category' });

  expect(result.competitors).toHaveLength(75);
  expect(fetch).toHaveBeenCalledTimes(75);
  expect(peakRequests).toBeLessThanOrEqual(8);
});

it('never fabricates a competitor -- returns an empty list when the model finds none, without retrying', async () => {
  mocks.webSearch.mockResolvedValue({
    content: JSON.stringify({ isSpecificEntity: false, entitySummary: '', competitors: [] }),
  });
  vi.stubGlobal('fetch', vi.fn());

  const result = await researchCompetitors({ query: 'a totally obscure niche business' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(1);
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
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      isSpecificEntity: true,
      entitySummary: '',
      competitors: [{
        name: 'Competitor A',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Same category, customers, and market',
        positioning: '',
        sourceUrl: 'https://competitor.example.com',
      }],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Competitor A', date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current' },
        { competitorName: 'Competitor A', date: '2026-09-07', activity: 'Published an old offer', sourceUrl: 'https://competitor.example.com/old' },
        { competitorName: 'Competitor A', date: '2026-09-13', activity: 'Claim with a dead source', sourceUrl: 'https://dead.example.com/post' },
        { competitorName: 'Competitor A', date: '', activity: 'Undated claim', sourceUrl: 'https://competitor.example.com/undated' },
      ],
    }) });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: !String(url).includes('dead.example.com'),
    status: String(url).includes('dead.example.com') ? 404 : 200,
  })));

  const result = await researchCompetitors({
    query: 'Competitor A',
    activityStartDate: '2026-09-08',
    activityEndDate: '2026-09-14',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(2);
  expect(result.competitors[0].recentActivities).toEqual([
    { date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current', platform: 'Web' },
  ]);
});

it('looks up Facebook/TikTok/LinkedIn activity by exact name only once competitors are known', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
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
      }],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Social Academy', date: '2026-09-18', activity: 'Posted a course promotion', sourceUrl: 'https://www.facebook.com/socialacademy/posts/123' },
        { competitorName: 'Social Academy', date: '2026-09-17', activity: 'Published a short training video', sourceUrl: 'https://www.tiktok.com/@socialacademy/video/456' },
        { competitorName: 'Social Academy', date: '2026-09-16', activity: 'Announced a workshop', sourceUrl: 'https://www.linkedin.com/posts/socialacademy_workshop-activity-789' },
      ],
    }) });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: String(url).includes('socialacademy.example.com'),
    status: String(url).includes('socialacademy.example.com') ? 200 : 403,
  })));

  const result = await researchCompetitors({
    query: 'business training',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(2);
  const [discoveryRequest] = mocks.webSearch.mock.calls[0];
  const [activityRequest] = mocks.webSearch.mock.calls[1];
  expect(discoveryRequest.prompt).toContain('FACEBOOK:');
  expect(discoveryRequest.prompt).toContain('TIKTOK:');
  expect(discoveryRequest.prompt).toContain('LINKEDIN:');
  expect(activityRequest.prompt).toContain('Social Academy');
  expect(activityRequest.prompt).toContain('2026-09-12');
  expect(activityRequest.prompt).toContain('2026-09-18');
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

it('retries the discovery search once when it returns unparseable content, then succeeds', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: 'the model returned no usable output' })
    .mockResolvedValueOnce({ content: JSON.stringify({
      isSpecificEntity: true,
      entitySummary: 'Rival Cafe is a coffee shop in Phnom Penh.',
      competitors: [{
        name: 'Rival Cafe',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Serves the same cafe customers in Phnom Penh',
        positioning: '',
        sourceUrl: 'https://rival-cafe.example.com',
      }],
    }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'cafes Phnom Penh' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(2);
  expect(result.competitors[0].name).toBe('Rival Cafe');
});

it('retries the discovery search once when it rejects, then succeeds', async () => {
  mocks.webSearch
    .mockRejectedValueOnce(new Error('OpenRouter web search request failed.'))
    .mockResolvedValueOnce({ content: JSON.stringify({
      isSpecificEntity: true,
      entitySummary: '',
      competitors: [{
        name: 'DataU Academy',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Provides competing professional AI training in Phnom Penh',
        positioning: '',
        sourceUrl: 'https://datau.example.com',
      }],
    }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'AI training academies Phnom Penh' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(2);
  expect(result.competitors[0].name).toBe('DataU Academy');
});

it('gives up discovery after a single retry instead of calling OpenRouter repeatedly', async () => {
  mocks.webSearch.mockRejectedValue(new Error('OpenRouter web search request failed.'));

  await expect(researchCompetitors({ query: 'unreachable niche' })).rejects.toThrow('OpenRouter web search request failed.');

  expect(mocks.webSearch).toHaveBeenCalledTimes(2);
});

it('retries the activity search once when it returns unparseable data, then finds activity', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [{
        name: 'DataU Academy',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Provides competing professional AI training in Phnom Penh',
        positioning: '',
        linkedinUrl: 'https://kh.linkedin.com/company/datauacademy',
        sourceUrl: 'https://kh.linkedin.com/company/datauacademy',
      }],
    }) })
    .mockResolvedValueOnce({ content: 'no usable output' })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [{
        competitorName: 'DataU Academy',
        date: '2026-09-22',
        contentType: 'Post',
        title: 'AI at Work toolkit for professionals',
        activity: 'Promoted a practical AI toolkit course for professionals',
        summary: 'The post presents reusable AI prompts and workflows for finance, HR, and operations professionals.',
        keyDetails: ['Self-paced course', 'Targets finance, HR, and operations roles'],
        sourceUrl: 'https://kh.linkedin.com/company/datauacademy',
      }],
    }) });
  vi.stubGlobal('fetch', vi.fn());

  const result = await researchCompetitors({
    query: 'AI training academies Phnom Penh',
    activityStartDate: '2026-09-16',
    activityEndDate: '2026-09-22',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
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

it('keeps the verified competitor list even if the activity search fails every attempt, including the Facebook/TikTok follow-up', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [{
        name: 'Rival Cafe',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Serves the same cafe customers in Phnom Penh',
        positioning: '',
        sourceUrl: 'https://rival-cafe.example.com',
      }],
    }) })
    .mockRejectedValueOnce(new Error('search failed'))
    .mockRejectedValueOnce(new Error('search failed again'))
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  // 1 discovery + 2 activity attempts (both failed) + 1 Facebook/TikTok-focused follow-up.
  expect(mocks.webSearch).toHaveBeenCalledTimes(4);
  expect(mocks.webSearch.mock.calls[3][0].prompt).toContain('prioritize searching their Facebook Page and TikTok profile');
  expect(result.competitors).toHaveLength(1);
  expect(result.competitors[0].recentActivities).toEqual([]);
});

it('gives every still-empty competitor one Facebook/TikTok-focused follow-up call after the main activity search', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [
        { name: 'Rival Cafe', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Serves the same cafe customers in Phnom Penh', positioning: '', sourceUrl: 'https://rival-cafe.example.com' },
        { name: 'Bean Society', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Serves the same cafe customers in Phnom Penh', positioning: '', sourceUrl: 'https://bean-society.example.com' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Rival Cafe', date: '2026-09-16', activity: 'Posted a weekend offer', sourceUrl: 'https://rival-cafe.example.com/news/offer' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Bean Society', date: '2026-09-17', activity: 'Posted a new menu on Facebook', sourceUrl: 'https://www.facebook.com/beansociety/posts/999' },
      ],
    }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
  const followUpPrompt = mocks.webSearch.mock.calls[2][0].prompt;
  expect(followUpPrompt).toContain('Bean Society');
  expect(followUpPrompt).not.toContain('Rival Cafe');
  const beanSociety = result.competitors.find((c) => c.name === 'Bean Society');
  expect(beanSociety.recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-17', platform: 'Facebook' }),
  ]);
});

it('merges Meta Ad Library results without spending an extra OpenRouter call, when configured', async () => {
  mocks.isMetaAdLibraryConfigured.mockReturnValue(true);
  mocks.fetchMetaAdLibraryActivity.mockImplementation(async ({ businessName }) => (
    businessName === 'Rival Cafe'
      ? [{ date: '2026-09-15', contentType: 'Ad', title: 'Weekend Combo Promo', activity: 'Weekend Combo Promo', summary: '', sourceUrl: 'https://www.facebook.com/ads/library/?id=123' }]
      : []
  ));
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [{
        name: 'Rival Cafe',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Serves the same cafe customers in Phnom Penh',
        positioning: '',
        sourceUrl: 'https://rival-cafe.example.com',
      }],
    }) })
    // A non-empty (but non-matching) activities array is "usable" so this
    // resolves stage 2 in a single attempt; Rival Cafe still ends up empty
    // and falls through to the Facebook/TikTok follow-up call below.
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [
      { competitorName: 'Some Other Business', date: '2026-09-16', activity: 'Unrelated post', sourceUrl: 'https://example.com/post' },
    ] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    countryCode: 'KH',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  // 1 discovery + 1 activity attempt + 1 Facebook/TikTok follow-up (still empty
  // after the activity attempt) -- Meta Ad Library is a plain HTTP call, not
  // an OpenRouter call, so it adds none of these.
  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
  expect(mocks.fetchMetaAdLibraryActivity).toHaveBeenCalledWith(expect.objectContaining({
    businessName: 'Rival Cafe',
    countryCode: 'KH',
    startDate: '2026-09-12',
    endDate: '2026-09-18',
  }));
  expect(result.competitors[0].recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-15', contentType: 'Ad', platform: 'Facebook' }),
  ]);
});

it('skips Meta Ad Library entirely when not configured', async () => {
  mocks.isMetaAdLibraryConfigured.mockReturnValue(false);
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [{
        name: 'Rival Cafe',
        isDirectCompetitor: true,
        matchConfidence: 'high',
        matchReason: 'Serves the same cafe customers in Phnom Penh',
        positioning: '',
        sourceUrl: 'https://rival-cafe.example.com',
      }],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [
      { competitorName: 'Some Other Business', date: '2026-09-16', activity: 'Unrelated post', sourceUrl: 'https://example.com/post' },
    ] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.fetchMetaAdLibraryActivity).not.toHaveBeenCalled();
  expect(result.competitors[0].recentActivities).toEqual([]);
});
