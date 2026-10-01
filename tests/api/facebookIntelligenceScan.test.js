import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  searchBusinesses: vi.fn(),
  researchCompetitors: vi.fn(),
  researchMarketTrends: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('../../api/_openrouter.js', () => ({
  generateOpenRouterImage: vi.fn(),
  generateOpenRouterSpeech: vi.fn(),
  generateOpenRouterText: mocks.text,
  generateTranslateSpeech: vi.fn(),
  pollOpenRouterVideo: vi.fn(),
  startOpenRouterVideo: vi.fn(),
  synthesizeSpeechViaOpenRouter: vi.fn(),
  transcribeAudioWithOpenRouter: vi.fn(),
  resolveOpenRouterTextModel: () => 'test-model',
  redactSecrets: (value) => String(value || ''),
}));
vi.mock('../../api/_khmerNarration.js', () => ({ createKhmerNarration: vi.fn(), generateKhmerSpeech: vi.fn() }));
vi.mock('../../api/_videoSpeech.js', () => ({ preparePlanVideoSpeech: vi.fn() }));
vi.mock('../../api/_khmerVideo.js', () => ({ startKhmerVideoJob: vi.fn() }));
vi.mock('../../api/_firebaseAdmin.js', () => ({
  default: { auth: vi.fn() },
  initFirebaseAdmin: () => ({}),
}));
vi.mock('../../api/_rateLimit.js', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_alert.js', () => ({ notifyAdmins: vi.fn() }));
vi.mock('../../api/_webBusinessSearch.js', () => ({ searchBusinessesOnWeb: mocks.searchBusinesses }));
vi.mock('../../api/_competitorResearch.js', () => ({ researchCompetitors: mocks.researchCompetitors }));
vi.mock('../../api/_marketTrendResearch.js', () => ({ researchMarketTrends: mocks.researchMarketTrends }));
vi.mock('../../api/_imagekitUpload.js', () => ({ uploadMediaDataUrl: vi.fn() }));
vi.mock('../../api/_email.js', () => ({ sendOutreachEmail: vi.fn() }));

import handler, { DEFAULT_COMPETITOR_ENTITY_CAP, DEFAULT_SCAN_ENTITY_CAP } from '../../api/ai.js';

const responseRecorder = () => {
  const response = {
    statusCode: 200,
    body: undefined,
    setHeader: vi.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return response;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.researchCompetitors.mockResolvedValue({ competitors: [], entitySummary: '' });
  mocks.researchMarketTrends.mockResolvedValue([]);
  mocks.searchBusinesses.mockResolvedValue([{
    businessName: 'Sokha Painting Service',
    entityKind: 'service_provider',
    serviceOrJobType: 'House painter',
    businessType: 'Painting service',
    sourceUrl: 'https://services.example.com/sokha-painting',
  }]);
  mocks.text.mockResolvedValue(JSON.stringify({
    customerInsights: {
      whatTheyBought: [],
      whatTheyLike: [],
      contentDesires: [],
      targetPersonas: [],
    },
    competitors: [],
    potentialLeads: [{
      businessName: 'Sokha Painting Service',
      businessType: 'Painting service',
      recommendedService: 'Local lead generation',
    }],
    videoPlan: [],
    summaryReport: 'Verified worker search.',
  }));
});

it('routes the workers scan mode through worker/trade web discovery end to end', async () => {
  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'house painters Phnom Penh',
      scanMode: 'workers',
      countries: ['KH'],
      days: 7,
      language: 'en',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(mocks.searchBusinesses).toHaveBeenCalledWith(expect.objectContaining({
    searchTerms: 'house painters Phnom Penh',
    entityScope: 'workers',
    targetCount: DEFAULT_SCAN_ENTITY_CAP,
  }));
  expect(res.body).toMatchObject({
    success: true,
    scanMode: 'workers',
    potentialLeads: [{
      businessName: 'Sokha Painting Service',
      entityKind: 'service_provider',
      serviceOrJobType: 'House painter',
    }],
  });
});

it('returns dated competitor activity and its exact 7-day window', async () => {
  mocks.researchCompetitors.mockImplementation(async ({ activityStartDate, activityEndDate }) => ({
    competitors: [{
      name: 'Verified Rival',
      matchReason: 'Offers the same service to the same market.',
      positioning: 'Premium local service',
      facebookUrl: 'https://www.facebook.com/verified-rival',
      tiktokUrl: 'https://www.tiktok.com/@verifiedrival',
      linkedinUrl: 'https://www.linkedin.com/company/verified-rival/',
      sourceUrl: 'https://rival.example.com',
      recentActivities: [{
        date: activityEndDate,
        activity: 'Published a seven-day promotional campaign.',
        sourceUrl: 'https://www.facebook.com/verified-rival/posts/123',
        platform: 'Facebook',
      }],
    }],
    entitySummary: 'A local service category.',
  }));
  mocks.text.mockResolvedValue(JSON.stringify({
    customerInsights: { whatTheyBought: [], whatTheyLike: [], contentDesires: [], targetPersonas: [] },
    competitors: [{
      pageName: 'Verified Rival',
      topAngle: 'Premium service',
      customerSegments: ['Customers seeking premium local service'],
    }],
    potentialLeads: [],
    videoPlan: [],
    summaryReport: 'Competitor activity scan.',
  }));

  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'local service competitors',
      scanMode: 'competitor_activity',
      countries: ['KH'],
      days: 7,
      language: 'en',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(mocks.researchCompetitors).toHaveBeenCalledWith(expect.objectContaining({
    query: 'local service competitors',
    country: 'Cambodia',
    targetCount: DEFAULT_COMPETITOR_ENTITY_CAP,
    activityStartDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    activityEndDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  }));
  expect((new Date(`${res.body.activityWindow.endDate}T00:00:00Z`) - new Date(`${res.body.activityWindow.startDate}T00:00:00Z`)) / 86_400_000).toBe(6);
  expect(res.body).toMatchObject({
    success: true,
    scanMode: 'competitor_activity',
    competitors: [{
      pageName: 'Verified Rival',
      facebookUrl: 'https://www.facebook.com/verified-rival',
      tiktokUrl: 'https://www.tiktok.com/@verifiedrival',
      linkedinUrl: 'https://www.linkedin.com/company/verified-rival/',
      customerSegments: ['Customers seeking premium local service'],
      recentActivities: [{
        date: res.body.activityWindow.endDate,
        activity: 'Published a seven-day promotional campaign.',
        sourceUrl: 'https://www.facebook.com/verified-rival/posts/123',
        platform: 'Facebook',
      }],
    }],
  });
});

it('returns source-verified market waves for the exact 7-day window', async () => {
  mocks.researchMarketTrends.mockImplementation(async ({ endDate }) => [{
    topic: 'Short product demonstrations',
    date: endDate,
    evidence: 'Multiple public campaigns used concise product demonstrations.',
    opportunity: 'Create an eight-second proof-first demonstration video.',
    sourceUrl: 'https://trends.example.com/product-demos',
  }]);

  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'Cambodia skincare',
      scanMode: 'market_trends',
      countries: ['KH'],
      days: 7,
      language: 'en',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(mocks.researchMarketTrends).toHaveBeenCalledWith(expect.objectContaining({
    query: 'Cambodia skincare',
    country: 'Cambodia',
    startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  }));
  expect(res.body).toMatchObject({
    scanMode: 'market_trends',
    activityWindow: {
      startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      endDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    },
    marketTrends: [{
      topic: 'Short product demonstrations',
      sourceUrl: 'https://trends.example.com/product-demos',
    }],
  });
});

it('uses the Business Profile as the target for a generic competitor-activity instruction', async () => {
  mocks.researchCompetitors.mockImplementation(async ({ query, activityEndDate }) => ({
    competitors: query === 'DGACADEMY' ? [{
      name: 'Verified Academy Rival',
      matchReason: 'Provides competing professional training in Cambodia.',
      positioning: 'Professional training',
      sourceUrl: 'https://academy-rival.example.com',
      recentActivities: [{
        date: activityEndDate,
        activity: 'Published a new public training promotion.',
        sourceUrl: 'https://academy-rival.example.com/promotion',
      }],
    }] : [],
    entitySummary: query === 'DGACADEMY' ? 'A professional training academy.' : '',
  }));

  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'ស្វែងរកសកម្មភាពរបស់គូប្រកួតក្នុង ១ អាទិត្យ',
      businessName: 'DGACADEMY',
      scanMode: 'competitor_activity',
      countries: ['KH'],
      days: 7,
      language: 'km',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  expect(mocks.researchCompetitors).toHaveBeenCalledWith(expect.objectContaining({ query: 'DGACADEMY' }));
  expect(res.body).toMatchObject({
    researchTarget: 'DGACADEMY',
    competitors: [{
      pageName: 'Verified Academy Rival',
      recentActivities: [expect.objectContaining({ activity: 'Published a new public training promotion.' })],
    }],
  });
});

it('runs a grounded lead search, not an exact-verification dead end, when a customer scan names the owner\'s own business', async () => {
  mocks.searchBusinesses.mockResolvedValue([{
    businessName: 'Chamber of Professionals and Microenterprises of Cambodia (CPMEC)',
    entityKind: 'association',
    businessType: 'Professional association',
    sourceUrl: 'https://cpmec.example.com',
  }]);
  mocks.text.mockResolvedValue(JSON.stringify({
    customerInsights: { whatTheyBought: [], whatTheyLike: [], contentDesires: [], targetPersonas: [] },
    competitors: [],
    potentialLeads: [{
      businessName: 'Chamber of Professionals and Microenterprises of Cambodia (CPMEC)',
      businessType: 'Professional association',
      recommendedService: 'AI skills training for members',
    }],
    videoPlan: [],
    summaryReport: 'Found real potential customers for DGACADEMY.',
  }));

  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'ស្វែងរកអតិថិជនរបស់ក្រុមហ៊ុន DGACADEMY',
      businessName: 'DGACADEMY',
      businessDescription: 'An AI skills training academy in Phnom Penh.',
      scanMode: 'customer',
      countries: ['KH'],
      days: 7,
      language: 'km',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const searchCall = mocks.searchBusinesses.mock.calls[0][0];
  expect(searchCall.targetCount).toBe(DEFAULT_SCAN_ENTITY_CAP);
  expect(searchCall.searchObjective).toContain('AI skills training academy in Phnom Penh');
  expect(searchCall.searchObjective).not.toContain('Find ONLY the exact business named');
  expect(res.body.potentialLeads).toEqual([expect.objectContaining({
    businessName: 'Chamber of Professionals and Microenterprises of Cambodia (CPMEC)',
  })]);
  expect(res.body.audienceResearch).toBeFalsy();
});

it('looks up the owner\'s own business on the live web when no description was saved, instead of a dead end', async () => {
  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'ស្វែងរកអតិថិជនរបស់ក្រុម DGACADEMY',
      businessName: 'DGACADEMY',
      businessDescription: '',
      scanMode: 'customer',
      countries: ['KH'],
      days: 7,
      language: 'km',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const searchCall = mocks.searchBusinesses.mock.calls[0][0];
  expect(searchCall.targetCount).toBe(DEFAULT_SCAN_ENTITY_CAP);
  expect(searchCall.searchObjective).toContain('first determine what "DGACADEMY" actually sells or does');
  expect(searchCall.searchObjective).not.toContain('Find ONLY the exact business named');
  expect(res.body.potentialLeads).toEqual([expect.objectContaining({ businessName: 'Sokha Painting Service' })]);
  expect(res.body.audienceResearch).toBeFalsy();
});

it('also looks up a named business that is not the owner\'s own, instead of a dead end when no exact match is found', async () => {
  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    body: {
      action: 'facebookIntelligenceScan',
      query: 'customers of Sabay Digital',
      businessName: 'DGACADEMY',
      businessDescription: 'An AI skills training academy in Phnom Penh.',
      scanMode: 'customer',
      countries: ['KH'],
      days: 7,
      language: 'en',
    },
  };
  const res = responseRecorder();

  await handler(req, res);

  expect(res.statusCode).toBe(200);
  const searchCall = mocks.searchBusinesses.mock.calls[0][0];
  expect(searchCall.targetCount).toBe(DEFAULT_SCAN_ENTITY_CAP);
  expect(searchCall.searchObjective).toContain('first determine what "Sabay Digital" actually sells or does');
  expect(searchCall.searchObjective).not.toContain('Find ONLY the exact business named');
  // mocks.searchBusinesses (from beforeEach) never returns a business named
  // "Sabay Digital" -- findExactBusiness won't match -- yet this must still
  // return the real leads the search found, not the old "not verified" dead end.
  expect(res.body.potentialLeads).toEqual([expect.objectContaining({ businessName: 'Sokha Painting Service' })]);
  expect(res.body.audienceResearch).toBeFalsy();
  expect(res.body.summaryReport).not.toMatch(/not verified|could not be verified/i);
});
