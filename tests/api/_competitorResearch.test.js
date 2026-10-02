import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  webSearch: vi.fn(),
  lookup: vi.fn(),
  isMetaAdLibraryConfigured: vi.fn(),
  fetchMetaAdLibraryActivity: vi.fn(),
  isApifySocialActivityConfigured: vi.fn(),
  fetchApifySocialActivity: vi.fn(),
}));
vi.mock('../../api/_openrouter.js', () => ({ generateOpenRouterWebSearch: mocks.webSearch }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('../../api/_metaAdLibrary.js', () => ({
  isMetaAdLibraryConfigured: mocks.isMetaAdLibraryConfigured,
  fetchMetaAdLibraryActivity: mocks.fetchMetaAdLibraryActivity,
}));
vi.mock('../../api/_apifySocialActivity.js', () => ({
  isApifySocialActivityConfigured: mocks.isApifySocialActivityConfigured,
  fetchApifySocialActivity: mocks.fetchApifySocialActivity,
}));

import { researchCompetitors } from '../../api/_competitorResearch.js';

// Discovery now runs as three concurrent focused search passes (see the
// comment on discoveryFocuses in _competitorResearch.js) instead of one
// combined search, so every test below queues three discovery responses
// instead of one. This helper queues the same payload for all three passes
// when a test doesn't care about per-pass differences.
const queueDiscoveryTimes = (payload, times = 3) => {
  for (let i = 0; i < times; i += 1) mocks.webSearch.mockResolvedValueOnce(payload);
};

beforeEach(() => {
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  // Off by default so existing web-search-only tests are unaffected; tests
  // that care about the Meta Ad Library stage opt in explicitly.
  mocks.isMetaAdLibraryConfigured.mockReturnValue(false);
  mocks.fetchMetaAdLibraryActivity.mockResolvedValue([]);
  mocks.isApifySocialActivityConfigured.mockReturnValue(false);
  mocks.fetchApifySocialActivity.mockResolvedValue([]);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('uses the saved business description to disambiguate a brand name', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({ isSpecificEntity: true, entitySummary: '', competitors: [] }) });
  await researchCompetitors({ query: 'Dating Cafe & Mart', targetDescription: 'Cafe and mini mart selling coffee and groceries.' });
  expect(mocks.webSearch.mock.calls.slice(0, 3).every(([request]) => (
    request.prompt.includes('Cafe and mini mart selling coffee and groceries.')
    && request.prompt.includes('Dating Cafe & Mart')
  ))).toBe(true);
});

it('uses only the current owner profile as identity evidence for its target', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({ isSpecificEntity: true, entitySummary: '', competitors: [] }) });
  const logoDataUrl = 'data:image/png;base64,aGVsbG8=';
  await researchCompetitors({
    query: 'DJ Academy',
    targetDescription: 'AI skills training in Phnom Penh',
    targetFacebookPageUrl: 'https://www.facebook.com/djacademy',
    targetLogoDataUrl: logoDataUrl,
  });
  for (const [request] of mocks.webSearch.mock.calls.slice(0, 3)) {
    expect(request.imageDataUrl).toBe(logoDataUrl);
    expect(request.prompt).toContain('AI skills training in Phnom Penh');
    expect(request.prompt).toContain('https://www.facebook.com/djacademy');
    expect(request.prompt).toContain('Record no link based on a shared word, logo alone');
  }
});

it('does not return the target or its alternate Page name as a competitor', async () => {
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({
    isSpecificEntity: true,
    competitors: [
      { name: 'DJ Academy', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same AI courses', sourceUrl: 'https://www.facebook.com/djacademy' },
      { name: 'AI Academy Cambodia', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same AI courses', facebookUrl: 'https://www.facebook.com/djacademy', sourceUrl: 'https://www.facebook.com/djacademy' },
      { name: 'Independent AI School', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same AI courses and customers', sourceUrl: 'https://www.facebook.com/independent-ai-school' },
    ],
  }) });

  const result = await researchCompetitors({
    query: 'DJ Academy', targetDescription: 'AI skills training',
    targetFacebookPageUrl: 'https://www.facebook.com/djacademy',
  });

  expect(result.competitors.map(({ name }) => name)).toEqual(['Independent AI School']);
});

it('retries discovery without the logo if the configured model rejects images', async () => {
  mocks.webSearch.mockImplementation(({ imageDataUrl }) => imageDataUrl
    ? Promise.reject(new Error('image input unsupported'))
    : Promise.resolve({ content: JSON.stringify({ isSpecificEntity: true, competitors: [] }) }));

  const result = await researchCompetitors({
    query: 'Kafe', targetDescription: 'Coffee shop', targetLogoDataUrl: 'data:image/jpeg;base64,aGVsbG8=',
  });

  expect(result.competitors).toEqual([]);
  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
  expect(mocks.webSearch.mock.calls.filter(([request]) => !request.imageDataUrl)).toHaveLength(3);
});

it('does not attach a different Facebook Page post to a known competitor', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    isSpecificEntity: true,
    competitors: [{
      name: 'Kafe Dating',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Same coffee products and Phnom Penh customers',
      facebookUrl: 'https://www.facebook.com/kafe.kh',
      sourceUrl: 'https://kafe.example.com',
    }],
  }) });
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ activities: [
    { competitorName: 'Kafe Dating', date: '2026-09-30', activity: 'A coffee offer.', sourceUrl: 'https://www.facebook.com/another-cafe/posts/123' },
    { competitorName: 'Kafe Dating', date: '2026-09-30', activity: 'A real coffee offer.', sourceUrl: 'https://www.facebook.com/kafe.kh/posts/456' },
  ] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'DJ Academy', activityStartDate: '2026-09-26', activityEndDate: '2026-10-02',
  });

  expect(result.competitors[0].recentActivities.map(({ sourceUrl }) => sourceUrl)).toEqual([
    'https://www.facebook.com/kafe.kh/posts/456',
  ]);
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

  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
  expect(result.isSpecificEntity).toBe(true);
  expect(result.entitySummary).toContain('DGACADEMY');
  expect(result.competitors).toEqual([
    { name: 'Real School A', matchReason: 'Same English courses and city', marketPresence: '', positioning: 'Premium pricing', facebookUrl: '', tiktokUrl: '', linkedinUrl: 'https://www.linkedin.com/school/real-school-a/', sourceUrl: 'https://real-school-a.example.com' },
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

it('splits discovery into focused search passes and dedupes entries found across them', async () => {
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [
        { name: 'Academy A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same courses and city', positioning: '', linkedinUrl: 'https://www.linkedin.com/company/academy-a/', sourceUrl: 'https://directory.example.com/academy-a' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [
        { name: 'Academy A', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same courses and city', positioning: 'Professional training', linkedinUrl: 'https://www.linkedin.com/company/academy-a/', sourceUrl: 'https://www.linkedin.com/company/academy-a/' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      competitors: [
        { name: 'Academy B', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same audience and training category', positioning: '', sourceUrl: 'https://academy-b.example.com' },
      ],
    }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'business training' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
  const prompts = mocks.webSearch.mock.calls.map(([request]) => request.prompt);
  expect(prompts.some((prompt) => prompt.includes('PUBLIC PAGES:') && prompt.includes('site:facebook.com') && prompt.includes('site:linkedin.com'))).toBe(true);
  expect(result.competitors).toHaveLength(2);
  expect(result.competitors.find((c) => c.name === 'Academy A')).toMatchObject({
    matchReason: 'Same courses and city',
    positioning: 'Professional training',
    linkedinUrl: 'https://www.linkedin.com/company/academy-a/',
  });
  expect(result.competitors.find((c) => c.name === 'Academy B')).toBeTruthy();
});

it('keeps same-name competitors with a shared directory URL and their posts separate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({
    competitors: [
      { name: 'Kafe', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same coffee offer and local market', marketPresence: 'weaker', facebookUrl: 'https://www.facebook.com/kafe-one', sourceUrl: 'https://directory.example.com/cafes' },
      { name: 'Kafe', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same coffee offer and local market', marketPresence: 'weaker', facebookUrl: 'https://www.facebook.com/kafe-two', sourceUrl: 'https://directory.example.com/cafes' },
    ],
    activities: [
      { competitorName: 'Kafe', date: '2026-10-01', activity: 'First Page offer', sourceUrl: 'https://www.facebook.com/kafe-one/posts/11' },
      { competitorName: 'Kafe', date: '2026-10-01', activity: 'Second Page offer', sourceUrl: 'https://www.facebook.com/kafe-two/posts/22' },
    ],
  }) });

  const result = await researchCompetitors({
    query: 'coffee shops', activityStartDate: '2026-09-26', activityEndDate: '2026-10-02',
  });

  expect(result.competitors).toHaveLength(2);
  expect(result.competitors.map((candidate) => candidate.facebookUrl)).toEqual([
    'https://www.facebook.com/kafe-one', 'https://www.facebook.com/kafe-two',
  ]);
  expect(result.competitors.map((candidate) => candidate.recentActivities.map((post) => post.activity))).toEqual([
    ['First Page offer'], ['Second Page offer'],
  ]);
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

  expect(mocks.webSearch).toHaveBeenCalledTimes(3);
  expect(result.competitors).toEqual([]);
  expect(result.isSpecificEntity).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('does not treat a dating app as a competitor of a cafe and mart', async () => {
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({
    isSpecificEntity: true,
    entitySummary: 'Dating Cafe & Mart is a cafe and convenience store.',
    competitors: [{
      name: 'Dating App',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Online dating and matchmaking for singles who may meet at cafes',
      marketPresence: 'stronger',
      positioning: 'Dating website',
      sourceUrl: 'https://dating-app.example.com',
    }],
  }) });
  vi.stubGlobal('fetch', vi.fn());

  const result = await researchCompetitors({ query: 'Dating Cafe & Mart' });

  expect(result.competitors).toEqual([]);
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
  queueDiscoveryTimes({ content: JSON.stringify({
    isSpecificEntity: false,
    entitySummary: '',
    competitors: [{
      name: 'Competitor A',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Same category, customers, and market',
      positioning: '',
      sourceUrl: 'https://competitor.example.com',
    }],
  }) });
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Competitor A', date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current' },
        { competitorName: 'Competitor A', date: '2026-09-07', activity: 'Published an old offer', sourceUrl: 'https://competitor.example.com/old' },
        { competitorName: 'Competitor A', date: '2026-09-13', activity: 'Claim with a dead source', sourceUrl: 'https://dead.example.com/post' },
        { competitorName: 'Competitor A', date: '', activity: 'Undated claim', sourceUrl: 'https://competitor.example.com/undated' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: !String(url).includes('dead.example.com'),
    status: String(url).includes('dead.example.com') ? 404 : 200,
  })));

  const result = await researchCompetitors({
    query: 'training schools',
    activityStartDate: '2026-09-08',
    activityEndDate: '2026-09-14',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(5);
  expect(result.competitors[0].recentActivities).toEqual([
    { date: '2026-09-14', activity: 'Published a new course offer', sourceUrl: 'https://competitor.example.com/current', platform: 'Web' },
  ]);
});

it('looks up Facebook/TikTok/LinkedIn activity by exact name only once competitors are known', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
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
  }) });
  mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify({
    activities: [
      { competitorName: 'Social Academy', date: '2026-09-18', activity: 'Posted a course promotion', sourceUrl: 'https://www.facebook.com/socialacademy/posts/123' },
      { competitorName: 'Social Academy', date: '2026-09-17', activity: 'Published a short training video', sourceUrl: 'https://www.tiktok.com/@socialacademy/video/456' },
      { competitorName: 'Social Academy', date: '2026-09-16', activity: 'Announced a workshop', publisherPageUrl: 'https://www.linkedin.com/company/socialacademy/', sourceUrl: 'https://www.linkedin.com/posts/socialacademy_workshop-activity-789' },
    ],
  }) });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: String(url).includes('socialacademy'),
    status: String(url).includes('socialacademy') ? 200 : 403,
  })));

  const result = await researchCompetitors({
    query: 'business training',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(4);
  const [discoveryRequest] = mocks.webSearch.mock.calls[0];
  const [activityRequest] = mocks.webSearch.mock.calls[3];
  expect(discoveryRequest.prompt).toContain('Step 1');
  expect(activityRequest.prompt).toContain('Social Academy');
  expect(activityRequest.prompt).toContain('2026-09-12');
  expect(activityRequest.prompt).toContain('2026-09-18');
  expect(result.competitors[0]).toMatchObject({
    facebookUrl: 'https://www.facebook.com/socialacademy',
    tiktokUrl: '',
    linkedinUrl: 'https://www.linkedin.com/company/socialacademy/',
    recentActivities: [
      expect.objectContaining({ platform: 'Facebook' }),
      expect.objectContaining({ platform: 'LinkedIn' }),
    ],
  });
});

it('retries the discovery search once when it returns unparseable content, then succeeds', async () => {
  const goodResponse = { content: JSON.stringify({
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
  }) };
  queueDiscoveryTimes({ content: 'the model returned no usable output' });
  queueDiscoveryTimes(goodResponse);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'cafes Phnom Penh' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
  expect(result.competitors[0].name).toBe('Rival Cafe');
});

it('retries the discovery search once when it rejects, then succeeds', async () => {
  const goodResponse = { content: JSON.stringify({
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
  }) };
  mocks.webSearch
    .mockRejectedValueOnce(new Error('OpenRouter web search request failed.'))
    .mockRejectedValueOnce(new Error('OpenRouter web search request failed.'))
    .mockRejectedValueOnce(new Error('OpenRouter web search request failed.'));
  queueDiscoveryTimes(goodResponse);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'AI training academies Phnom Penh' });

  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
  expect(result.competitors[0].name).toBe('DataU Academy');
});

it('gives up discovery after a single retry instead of calling OpenRouter repeatedly', async () => {
  mocks.webSearch.mockRejectedValue(new Error('OpenRouter web search request failed.'));

  await expect(researchCompetitors({ query: 'unreachable niche' })).rejects.toThrow('OpenRouter web search request failed.');

  // 3 concurrent focused passes, each retrying once = 6 attempts total.
  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
});

it('retries the activity search once when it returns unparseable data, then finds activity', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'DataU Academy',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Provides competing professional AI training in Phnom Penh',
      positioning: '',
      linkedinUrl: 'https://kh.linkedin.com/company/datauacademy',
      sourceUrl: 'https://kh.linkedin.com/company/datauacademy',
    }],
  }) });
  mocks.webSearch
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
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  // The discovered linkedinUrl is now live-checked before being shown as a
  // clickable competitor link, unlike the sourceUrl/activity evidence above
  // (which stay exempt from HTTP checks -- see isSupportedPublicSocialUrl).
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'AI training academies Phnom Penh',
    activityStartDate: '2026-09-16',
    activityEndDate: '2026-09-22',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
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
  expect(result.competitors[0].linkedinUrl).toBe('https://kh.linkedin.com/company/datauacademy');
});

it('keeps the verified competitor list even if the activity search fails every attempt, including the Facebook/TikTok follow-up', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch
    .mockRejectedValueOnce(new Error('search failed'))
    .mockRejectedValueOnce(new Error('search failed again'))
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  // 3 discovery passes + 2 activity attempts (both failed) + one focused Facebook pass.
  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
  expect(mocks.webSearch.mock.calls[5][0].prompt).toContain('Search ONLY Facebook');
  expect(result.competitors).toHaveLength(1);
  expect(result.competitors[0].recentActivities).toEqual([]);
});

it('searches Facebook even when LinkedIn activity was already found', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [
      { name: 'Rival Cafe', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Serves the same cafe customers in Phnom Penh', positioning: '', linkedinUrl: 'https://www.linkedin.com/company/rival-cafe/', sourceUrl: 'https://rival-cafe.example.com' },
      { name: 'Bean Society', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Serves the same cafe customers in Phnom Penh', positioning: '', sourceUrl: 'https://bean-society.example.com' },
    ],
  }) });
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Rival Cafe', date: '2026-09-16', activity: 'Posted a weekend offer', publisherPageUrl: 'https://www.linkedin.com/company/rival-cafe/', sourceUrl: 'https://www.linkedin.com/posts/rival-cafe_offer-123' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Bean Society', date: '2026-09-17', activity: 'Posted a new menu on Facebook', sourceUrl: 'https://www.facebook.com/beansociety/posts/999' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [
        { competitorName: 'Rival Cafe', date: '2026-09-18', activity: 'Published a short menu video', sourceUrl: 'https://www.tiktok.com/@rivalcafe/video/123' },
      ],
    }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(5);
  const facebookPrompt = mocks.webSearch.mock.calls[4][0].prompt;
  expect(facebookPrompt).toContain('Bean Society');
  expect(facebookPrompt).toContain('Rival Cafe');
  expect(facebookPrompt).toContain('Search ONLY Facebook');
  expect(result.competitors.find((c) => c.name === 'Rival Cafe').recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-16', platform: 'LinkedIn' }),
  ]);
  const beanSociety = result.competitors.find((c) => c.name === 'Bean Society');
  expect(beanSociety.recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-17', platform: 'Facebook' }),
  ]);
});

it('keeps newly discovered social profiles and directly enriches them', async () => {
  mocks.isApifySocialActivityConfigured.mockReturnValue(true);
  mocks.fetchApifySocialActivity
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { competitorName: 'Rival Cafe', date: '2026-09-18', activity: 'Published a Facebook offer.', sourceUrl: 'https://www.facebook.com/rivalcafe/posts/111' },
      { competitorName: 'Rival Cafe', date: '2026-09-17', activity: 'Published a TikTok video.', sourceUrl: 'https://www.tiktok.com/@rivalcafe/video/222' },
    ]);
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      linkedinUrl: 'https://www.linkedin.com/company/rival-cafe/',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [
      { competitorName: 'Rival Cafe', date: '2026-09-16', activity: 'Announced a class.', publisherPageUrl: 'https://www.linkedin.com/company/rival-cafe/', sourceUrl: 'https://www.linkedin.com/posts/rival-cafe_class-123' },
    ] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      profiles: [{ competitorName: 'Rival Cafe', profileUrl: 'https://www.facebook.com/rivalcafe' }],
      activities: [],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      profiles: [{ competitorName: 'Rival Cafe', profileUrl: 'https://www.tiktok.com/@rivalcafe' }],
      activities: [],
    }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.fetchApifySocialActivity).toHaveBeenCalledTimes(2);
  expect(mocks.fetchApifySocialActivity.mock.calls[1][0].candidates[0]).toMatchObject({
    facebookUrl: 'https://www.facebook.com/rivalcafe',
    tiktokUrl: '',
  });
  expect(result.competitors[0]).toMatchObject({
    facebookUrl: 'https://www.facebook.com/rivalcafe',
    tiktokUrl: '',
    recentActivities: [
      expect.objectContaining({ platform: 'Facebook' }),
      expect.objectContaining({ platform: 'LinkedIn' }),
    ],
  });
});

it('uses direct Facebook activity and website evidence without a social-search fallback', async () => {
  mocks.isApifySocialActivityConfigured.mockReturnValue(true);
  mocks.fetchApifySocialActivity.mockResolvedValue([
    { competitorName: 'Rival Cafe', date: '2026-09-18', contentType: 'Post', activity: 'Published a new menu.', sourceUrl: 'https://www.facebook.com/rivalcafe/posts/111' },
    { competitorName: 'Rival Cafe', date: '2026-09-17', contentType: 'Video', activity: 'Published a menu video.', sourceUrl: 'https://www.tiktok.com/@rivalcafe/video/222' },
  ]);
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      facebookUrl: 'https://www.facebook.com/rivalcafe',
      tiktokUrl: 'https://www.tiktok.com/@rivalcafe',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify({ activities: [
    { competitorName: 'Rival Cafe', date: '2026-09-16', activity: 'Updated its website.', sourceUrl: 'https://rival-cafe.example.com/news' },
  ] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.fetchApifySocialActivity).toHaveBeenCalledWith(expect.objectContaining({
    startDate: '2026-09-12',
    endDate: '2026-09-18',
  }));
  expect(mocks.webSearch).toHaveBeenCalledTimes(4);
  expect(result.competitors[0].recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-18', platform: 'Facebook' }),
    expect.objectContaining({ date: '2026-09-16', platform: 'Web' }),
  ]);
});

it('merges Meta Ad Library results without spending an extra OpenRouter call, when configured', async () => {
  mocks.isMetaAdLibraryConfigured.mockReturnValue(true);
  mocks.fetchMetaAdLibraryActivity.mockImplementation(async ({ businessName }) => (
    businessName === 'Rival Cafe'
      ? [{ date: '2026-09-15', contentType: 'Ad', title: 'Weekend Combo Promo', activity: 'Weekend Combo Promo', summary: '', sourceUrl: 'https://www.facebook.com/ads/library/?id=123' }]
      : []
  ));
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch
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
    countryCode: 'DE',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  // 3 discovery passes + 1 activity attempt + one focused pass per platform (still
  // empty after the activity attempt) -- Meta Ad Library is a plain HTTP call, not
  // an OpenRouter call, so it adds none of these.
  expect(mocks.webSearch).toHaveBeenCalledTimes(5);
  expect(mocks.fetchMetaAdLibraryActivity).toHaveBeenCalledWith(expect.objectContaining({
    businessName: 'Rival Cafe',
    countryCode: 'DE',
    startDate: '2026-09-12',
    endDate: '2026-09-18',
  }));
  expect(result.competitors[0].recentActivities).toEqual([
    expect.objectContaining({ date: '2026-09-15', contentType: 'Ad', platform: 'Facebook' }),
  ]);
});

it('skips Meta Ad Library entirely when not configured', async () => {
  mocks.isMetaAdLibraryConfigured.mockReturnValue(false);
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch
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
  expect(mocks.isMetaAdLibraryConfigured).toHaveBeenCalledWith('KH');
  expect(result.competitors[0].recentActivities).toEqual([]);
});

it('reports the most recent verified post when nothing falls inside the activity window', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch
    .mockRejectedValueOnce(new Error('search failed'))
    .mockRejectedValueOnce(new Error('search failed again'))
    .mockResolvedValueOnce({ content: JSON.stringify({
      activities: [],
      lastActivity: [
        { competitorName: 'Rival Cafe', date: '2026-07-02', activity: 'Posted a grand opening announcement.', sourceUrl: 'https://www.facebook.com/rivalcafe/posts/1' },
      ],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
  expect(result.competitors[0].recentActivities).toEqual([]);
  expect(result.competitors[0].lastKnownActivity).toEqual({
    date: '2026-07-02',
    activity: 'Posted a grand opening announcement.',
    sourceUrl: 'https://www.facebook.com/rivalcafe/posts/1',
    platform: 'Facebook',
  });
});

it('never reports a last-known post when real in-window activity was already found', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify({
    activities: [
      { competitorName: 'Rival Cafe', date: '2026-09-16', activity: 'Posted a weekend offer', sourceUrl: 'https://www.facebook.com/rivalcafe/posts/2' },
    ],
    lastActivity: [
      { competitorName: 'Rival Cafe', date: '2026-07-02', activity: 'Old post that should be ignored.', sourceUrl: 'https://www.facebook.com/rivalcafe/posts/1' },
    ],
  }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  expect(result.competitors[0].recentActivities).toHaveLength(1);
  expect(result.competitors[0].lastKnownActivity).toBeNull();
});

it('keeps a format-valid Facebook profile link even when it fails a live HTTP check, unlike TikTok/LinkedIn', async () => {
  // Facebook's edge returns a bare 400 for automated requests to real pages too
  // (verified live against facebook.com/facebook, /nike, /cocacola), so a live
  // check there can't tell a real Page from a dead one -- it would blank every
  // genuine Facebook link. TikTok/LinkedIn checks stay live because those do
  // distinguish real from dead in practice.
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      facebookUrl: 'https://www.facebook.com/rivalcafe',
      tiktokUrl: 'https://www.tiktok.com/@rivalcafe',
      linkedinUrl: 'https://www.linkedin.com/company/rival-cafe/',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  vi.stubGlobal('fetch', vi.fn(async (url) => (
    String(url).includes('rival-cafe.example.com') ? { ok: true, status: 200 } : { ok: false, status: 400 }
  )));

  const result = await researchCompetitors({ query: 'cafes Phnom Penh' });

  expect(result.competitors[0].facebookUrl).toBe('https://www.facebook.com/rivalcafe');
  expect(result.competitors[0].tiktokUrl).toBe('');
  expect(result.competitors[0].linkedinUrl).toBe('');
});

it('derives the Facebook Page link from a found post URL when discovery never returned one', async () => {
  // Real-world case: the model found rich, real dated Facebook posts (with a
  // Page-slug in each post URL) but left the separate "profiles" field empty,
  // so facebookUrl stayed blank even though we clearly have evidence of a
  // real, active Page.
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify({
    activities: [
      { competitorName: 'Rival Cafe', date: '2026-09-20', activity: 'Posted a weekend offer', sourceUrl: 'https://www.facebook.com/rivalcafe.kh/posts/123' },
      { competitorName: 'Rival Cafe', date: '2026-09-19', activity: 'Posted a reel', sourceUrl: 'https://www.facebook.com/reel/999/' },
    ],
  }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-23',
  });

  expect(result.competitors[0].facebookUrl).toBe('https://www.facebook.com/rivalcafe.kh');
});

it('never derives a Facebook Page link from a reel-only URL (no Page slug in the path)', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe',
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Serves the same cafe customers in Phnom Penh',
      positioning: '',
      sourceUrl: 'https://rival-cafe.example.com',
    }],
  }) });
  mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify({
    activities: [
      { competitorName: 'Rival Cafe', date: '2026-09-19', activity: 'Posted a reel', sourceUrl: 'https://www.facebook.com/reel/999/' },
    ],
  }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-23',
  });

  expect(result.competitors[0].facebookUrl).toBe('');
  expect(result.competitors[0].recentActivities).toEqual([]);
});

it('keeps an opaque reel only when its publisher matches the known Page', async () => {
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: [{
      name: 'Rival Cafe', isDirectCompetitor: true, matchConfidence: 'high',
      matchReason: 'Sells coffee to the same local customers',
      facebookUrl: 'https://www.facebook.com/rivalcafe',
      sourceUrl: 'https://www.facebook.com/rivalcafe',
    }],
  }) });
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ activities: [
    { competitorName: 'Rival Cafe', date: '2026-09-19', activity: 'Own reel', sourceUrl: 'https://www.facebook.com/reel/111', publisherPageUrl: 'https://www.facebook.com/rivalcafe' },
    { competitorName: 'Rival Cafe', date: '2026-09-19', activity: 'Other reel', sourceUrl: 'https://www.facebook.com/reel/222', publisherPageUrl: 'https://www.facebook.com/anothercafe' },
  ] }) });

  const result = await researchCompetitors({
    query: 'cafes Phnom Penh', activityStartDate: '2026-09-12', activityEndDate: '2026-09-23',
  });

  expect(result.competitors[0].recentActivities.map(({ activity }) => activity)).toEqual(['Own reel']);
});

it('batches the Facebook/TikTok profile lookup instead of listing every missing-platform competitor in one call', async () => {
  const names = Array.from({ length: 8 }, (_, index) => `Academy ${index + 1}`);
  queueDiscoveryTimes({ content: JSON.stringify({
    competitors: names.map((name) => ({
      name,
      isDirectCompetitor: true,
      matchConfidence: 'high',
      matchReason: 'Same category, customers, and market',
      positioning: '',
      sourceUrl: `https://${name.toLowerCase().replace(' ', '-')}.example.com`,
    })),
  }) });
  // Non-empty but unrelated to any candidate, so the main activity search
  // counts as "usable" in one attempt instead of retrying into emptiness.
  mocks.webSearch.mockResolvedValueOnce({ content: JSON.stringify({ activities: [
    { competitorName: 'Some Other Business', date: '2026-09-16', activity: 'Unrelated post', sourceUrl: 'https://example.com/post' },
  ] }) });
  // 8 candidates missing both platforms, batch size 6 -> 2 batches each for
  // Facebook and TikTok (6 + 2), in that order (Facebook's batches first).
  mocks.webSearch
    .mockResolvedValueOnce({ content: JSON.stringify({
      profiles: [{ competitorName: 'Academy 1', profileUrl: 'https://www.facebook.com/academy1' }],
      activities: [],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({
      profiles: [{ competitorName: 'Academy 8', profileUrl: 'https://www.facebook.com/academy8' }],
      activities: [],
    }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ profiles: [], activities: [] }) })
    .mockResolvedValueOnce({ content: JSON.stringify({ profiles: [], activities: [] }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({
    query: 'business training academies',
    activityStartDate: '2026-09-12',
    activityEndDate: '2026-09-18',
  });

  // 3 discovery + 1 main activity + 2 Facebook batches.
  expect(mocks.webSearch).toHaveBeenCalledTimes(6);
  const facebookBatch1 = mocks.webSearch.mock.calls[4][0].prompt;
  const facebookBatch2 = mocks.webSearch.mock.calls[5][0].prompt;
  expect(facebookBatch1).toContain('Academy 1');
  expect(facebookBatch1).not.toContain('Academy 8');
  expect(facebookBatch2).toContain('Academy 8');
  expect(facebookBatch2).not.toContain('Academy 1');
  // Both the batch-1 and batch-2 discovered profiles survive, proving results
  // from separate batches merge back into the same candidate pool correctly.
  expect(result.competitors.find((c) => c.name === 'Academy 1').facebookUrl).toBe('https://www.facebook.com/academy1');
  expect(result.competitors.find((c) => c.name === 'Academy 8').facebookUrl).toBe('https://www.facebook.com/academy8');
});

it('keeps verified smaller competitors and public-Page-only shops regardless of market presence', async () => {
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({
    competitors: [
      { name: 'Big Rival', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same category, customers, and market', marketPresence: 'stronger', positioning: '', sourceUrl: 'https://big-rival.example.com' },
      { name: 'Peer Rival', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same category, customers, and market', marketPresence: 'similar', positioning: '', sourceUrl: 'https://peer-rival.example.com' },
      { name: 'Small Rival', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same category, customers, and market', marketPresence: 'weaker', positioning: '', facebookUrl: 'https://www.facebook.com/small-rival-kh', sourceUrl: 'https://www.facebook.com/small-rival-kh' },
    ],
  }) });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

  const result = await researchCompetitors({ query: 'cafes Phnom Penh' });

  expect(result.competitors.map((c) => c.name)).toEqual(['Big Rival', 'Peer Rival', 'Small Rival']);
  expect(result.competitors[2].facebookUrl).toBe('https://www.facebook.com/small-rival-kh');
  expect(mocks.webSearch.mock.calls[1][0].prompt).toContain('Formal company registration');
});

it('rejects an opaque reel as the sole competitor source and clears a mismatched Page link', async () => {
  mocks.webSearch.mockResolvedValue({ content: JSON.stringify({ competitors: [
    { name: 'Unknown Cafe', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same coffee customers', sourceUrl: 'https://www.facebook.com/reel/123' },
    { name: 'Real Cafe', isDirectCompetitor: true, matchConfidence: 'high', matchReason: 'Same coffee customers', facebookUrl: 'https://www.facebook.com/another-cafe', sourceUrl: 'https://www.facebook.com/real-cafe' },
  ] }) });

  const result = await researchCompetitors({ query: 'cafes Phnom Penh' });

  expect(result.competitors).toEqual([expect.objectContaining({
    name: 'Real Cafe', sourceUrl: 'https://www.facebook.com/real-cafe', facebookUrl: '',
  })]);
});
