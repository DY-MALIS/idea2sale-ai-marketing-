import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  searchBusinesses: vi.fn(),
  researchCompetitors: vi.fn(),
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
vi.mock('../../api/_imagekitUpload.js', () => ({ uploadMediaDataUrl: vi.fn() }));
vi.mock('../../api/_email.js', () => ({ sendOutreachEmail: vi.fn() }));

import handler from '../../api/ai.js';

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
