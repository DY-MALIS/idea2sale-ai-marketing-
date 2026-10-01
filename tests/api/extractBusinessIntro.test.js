import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
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

const textDataUrl = (text) => `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
});

it('summarizes an uploaded introduction file into a saved business description', async () => {
  mocks.text.mockResolvedValue('We roast and sell specialty coffee beans in Phnom Penh.');
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'extractBusinessIntro',
      fileDataUrl: textDataUrl('Our company, founded in 2019, roasts single-origin coffee beans sourced from Mondulkiri and sells them to cafes across Phnom Penh.'),
      fileName: 'company-intro.txt',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ businessDescription: 'We roast and sell specialty coffee beans in Phnom Penh.' });
  expect(mocks.text).toHaveBeenCalledTimes(1);
  expect(mocks.text.mock.calls[0][0].prompt).toContain('Mondulkiri');
});

it('rejects the request when no file was sent', async () => {
  const req = { method: 'POST', headers: {}, body: { action: 'extractBusinessIntro', language: 'en' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toMatch(/choose a file/i);
  expect(mocks.text).not.toHaveBeenCalled();
});

it('surfaces a document-extraction failure with its own status and message', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'extractBusinessIntro',
      fileDataUrl: 'data:image/png;base64,aGVsbG8=',
      fileName: 'logo.png',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toMatch(/\.txt, \.pdf, or \.docx/i);
  expect(mocks.text).not.toHaveBeenCalled();
});

it('returns 502 when the AI summary comes back empty', async () => {
  mocks.text.mockResolvedValue('   ');
  const req = {
    method: 'POST',
    headers: {},
    body: { action: 'extractBusinessIntro', fileDataUrl: textDataUrl('Some real intro text.'), fileName: 'intro.txt', language: 'en' },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});
