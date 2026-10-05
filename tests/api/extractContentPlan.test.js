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

it('extracts a content plan from an uploaded PDF/Word/text file, not just CSV/Excel', async () => {
  mocks.text.mockResolvedValue(JSON.stringify([
    { date: '2026-10-10', type: 'image', topic: 'Grand opening', prompt: 'A bright storefront with a grand opening banner', headline: 'We are open!', cta: 'Visit us' },
  ]));
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'extractContentPlan',
      fileDataUrl: textDataUrl('Oct 10: grand opening post. Oct 12: behind-the-scenes video.'),
      fileName: 'content-brief.txt',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.items).toHaveLength(1);
  expect(res.body.items[0]).toMatchObject({ topic: 'Grand opening' });
  expect(mocks.text.mock.calls[0][0].prompt).toContain('grand opening');
});

it('surfaces a document-extraction failure for a file type it cannot read', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'extractContentPlan',
      // Real PNG magic bytes (not just a renamed text file) -- genuinely
      // binary content under an unrecognized/unreadable extension still
      // needs to be rejected, not decoded as garbled "text".
      fileDataUrl: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]).toString('base64')}`,
      fileName: 'plan-screenshot.png',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toMatch(/not supported/i);
  expect(mocks.text).not.toHaveBeenCalled();
});

it('still requires some source when neither text, a link, nor a file is sent', async () => {
  const req = { method: 'POST', headers: {}, body: { action: 'extractContentPlan', language: 'en' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toMatch(/CSV, Excel, PDF, Word, or text file/i);
});
