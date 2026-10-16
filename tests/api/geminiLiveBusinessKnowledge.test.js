import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  checkRateLimit: vi.fn(),
  liveToken: vi.fn(),
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
vi.mock('../../api/_khmerNarration.js', () => ({ createKhmerNarration: vi.fn(), generateKhmerConversationSpeech: vi.fn(), generateKhmerSpeech: vi.fn() }));
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
vi.mock('../../api/_webBusinessSearch.js', () => ({ searchBusinessesOnWeb: vi.fn() }));
vi.mock('../../api/_competitorResearch.js', () => ({ researchCompetitors: vi.fn() }));
vi.mock('../../api/_marketTrendResearch.js', () => ({ researchMarketTrends: vi.fn() }));
vi.mock('../../api/_imagekitUpload.js', () => ({ uploadMediaDataUrl: vi.fn() }));
vi.mock('../../api/_email.js', () => ({ sendOutreachEmail: vi.fn() }));
vi.mock('../../api/_websiteExtract.js', () => ({ extractWebsiteText: vi.fn() }));
vi.mock('../../api/_geminiLive.js', () => ({ createGeminiLiveEphemeralToken: mocks.liveToken }));

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
  mocks.liveToken.mockResolvedValue({ token: 'test-token', model: 'gemini-test', voiceName: 'Aoede', systemInstruction: '' });
});

it('folds the saved business knowledge base into the Live Voice system instruction', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'geminiLiveToken',
      businessContext: {
        businessName: 'DG Academy',
        businessKnowledgeBase: 'DG Academy is a training academy in Phnom Penh offering digital marketing, web development, and AI courses with evening classes.',
      },
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.liveToken).toHaveBeenCalledTimes(1);
  const systemInstruction = mocks.liveToken.mock.calls[0][0].systemInstruction;
  expect(systemInstruction).toContain('DETAILED BUSINESS KNOWLEDGE');
  expect(systemInstruction).toContain('digital marketing, web development, and AI courses');
});

it('folds an uploaded document knowledge base into the Live Voice system instruction too', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'geminiLiveToken',
      businessContext: {
        businessName: 'DG Academy',
        businessDocumentKnowledge: 'DG Academy runs evening and weekend digital marketing, web development, and AI courses in Phnom Penh.',
      },
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  const systemInstruction = mocks.liveToken.mock.calls[0][0].systemInstruction;
  expect(systemInstruction).toContain('DETAILED BUSINESS KNOWLEDGE FROM AN UPLOADED DOCUMENT/LINK');
  expect(systemInstruction).toContain('digital marketing, web development, and AI courses');
  expect(systemInstruction).toContain('never a vague or generic non-answer');
});

it('omits the detailed knowledge block entirely when no knowledge base is saved yet', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: { action: 'geminiLiveToken', businessContext: { businessName: 'DG Academy' } },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  const systemInstruction = mocks.liveToken.mock.calls[0][0].systemInstruction;
  expect(systemInstruction).not.toContain('DETAILED BUSINESS KNOWLEDGE');
});
