import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ text: vi.fn(), checkRateLimit: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({
  generateOpenRouterImage: vi.fn(), generateOpenRouterSpeech: vi.fn(), generateOpenRouterText: mocks.text,
  generateTranslateSpeech: vi.fn(), pollOpenRouterVideo: vi.fn(), startOpenRouterVideo: vi.fn(),
  synthesizeSpeechViaOpenRouter: vi.fn(), transcribeAudioWithOpenRouter: vi.fn(),
  resolveOpenRouterTextModel: () => 'test-model', redactSecrets: (value) => String(value || ''),
}));
vi.mock('../../api/_firebaseAdmin.js', () => ({ default: { auth: vi.fn() }, initFirebaseAdmin: () => ({}) }));
vi.mock('../../api/_rateLimit.js', () => ({ checkRateLimit: mocks.checkRateLimit, getClientIp: () => '127.0.0.1' }));

import handler from '../../api/ai.js';

const request = (language) => ({
  method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' },
  body: { action: 'productImageAnalyze', imageBase64: 'aGVsbG8=', imageMimeType: 'image/jpeg', language },
});
const response = () => ({
  statusCode: 200, body: null, setHeader: vi.fn(),
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
});

it('uses Khmer headings and localizes an English model response before returning it', async () => {
  mocks.text
    .mockResolvedValueOnce(JSON.stringify({ productSummary: 'Comfort Mattress', analysis: '**Visual & Technical Quality**\nThe mattress is shown in a warm bedroom.' }))
    .mockResolvedValueOnce(JSON.stringify({ productSummary: 'ពូកសម្រាប់ការគេងស្រួល', analysis: '**គុណភាពរូបភាព និងបច្ចេកទេស**\nរូបភាពនេះបង្ហាញពូកនៅក្នុងបន្ទប់គេងដែលមានពន្លឺទន់ភ្លន់ និងបរិយាកាសកក់ក្តៅសមស្របសម្រាប់ការផ្សាយពាណិជ្ជកម្ម។' }));
  const res = response();

  await handler(request('km'), res);

  expect(res.statusCode).toBe(200);
  expect(res.body.productSummary).toContain('ពូក');
  expect(res.body.analysis).toContain('គុណភាពរូបភាព');
  expect(mocks.text).toHaveBeenCalledTimes(2);
  expect(mocks.text.mock.calls[0][0].prompt).toContain('គុណភាពរូបភាព និងបច្ចេកទេស');
  expect(mocks.text.mock.calls[0][0].system).toContain('Khmer');
});

it('keeps a matching English response without an extra localization call', async () => {
  mocks.text.mockResolvedValue(JSON.stringify({ productSummary: 'Comfort Mattress', analysis: '**Visual & Technical Quality**\nThe mattress is shown in a warm bedroom.' }));
  const res = response();

  await handler(request('en'), res);

  expect(res.statusCode).toBe(200);
  expect(mocks.text).toHaveBeenCalledTimes(1);
  expect(res.body.analysis).toContain('Visual & Technical Quality');
});

it('replaces English section headings even when the body is mostly Khmer', async () => {
  const khmerBody = 'រូបភាពនេះបង្ហាញពូកនៅក្នុងបន្ទប់គេងដែលមានពន្លឺទន់ភ្លន់ និងបរិយាកាសកក់ក្តៅសមស្របសម្រាប់ការផ្សាយពាណិជ្ជកម្ម។';
  mocks.text
    .mockResolvedValueOnce(JSON.stringify({ productSummary: 'ពូកសម្រាប់គេងស្រួល', analysis: `Visual & Technical Quality\n${khmerBody}` }))
    .mockResolvedValueOnce(JSON.stringify({ productSummary: 'ពូកសម្រាប់គេងស្រួល', analysis: `គុណភាពរូបភាព និងបច្ចេកទេស\n${khmerBody}` }));
  const res = response();

  await handler(request('km'), res);

  expect(res.statusCode).toBe(200);
  expect(res.body.analysis).not.toContain('Visual & Technical Quality');
  expect(mocks.text).toHaveBeenCalledTimes(2);
});

it('does not display English analysis when Khmer localization also fails', async () => {
  mocks.text.mockResolvedValue(JSON.stringify({ productSummary: 'Comfort Mattress', analysis: '**Visual & Technical Quality**\nThe mattress is shown in a warm bedroom.' }));
  const res = response();

  await handler(request('km'), res);

  expect(res.statusCode).toBe(502);
  expect(res.body.error).toContain('ភាសាខ្មែរ');
});
