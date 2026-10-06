import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  checkRateLimit: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  startVideo: vi.fn(),
  text: vi.fn(),
}));

vi.mock('../../api/_openrouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  startOpenRouterVideo: mocks.startVideo,
  generateOpenRouterText: mocks.text,
}));
vi.mock('../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: mocks.verifyIdToken }) },
  initFirebaseAdmin: () => ({
    collection: () => ({
      where: () => ({ limit: () => ({ get: mocks.get }) }),
      doc: () => ({ set: mocks.set }),
    }),
  }),
}));
vi.mock('../../api/_rateLimit.js', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: () => '127.0.0.1',
}));

import handler from '../../api/ai.js';

const responseRecorder = () => ({
  statusCode: 200,
  body: undefined,
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe('video start recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verifyIdToken.mockResolvedValue({ uid: 'owner-1' });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.set.mockResolvedValue(undefined);
  });

  it('returns the original paid job only to its owner', async () => {
    mocks.get.mockResolvedValue({ docs: [
      { data: () => ({ userId: 'other-user', jobId: 'other-job' }) },
      { data: () => ({ userId: 'owner-1', jobId: 'my-job', startResponse: { jobId: 'my-job', narrationAudioUrl: 'https://example.com/audio.mp3' } }) },
    ] });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { action: 'videoRecover', requestId: '12345678-1234-1234-1234-123456789abc' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ jobId: 'my-job', narrationAudioUrl: 'https://example.com/audio.mp3' });
  });

  it('keeps the same request pending while the server prepares the video', async () => {
    mocks.get.mockResolvedValue({ docs: [] });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { action: 'videoRecover', requestId: '12345678-1234-1234-1234-123456789abc' } }, res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ status: 'starting' });
  });

  it('stores the start response before returning a paid job id', async () => {
    mocks.startVideo.mockResolvedValue({ jobId: 'paid-job' });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: {
      action: 'videoGenerate', requestId: '12345678-1234-1234-1234-123456789abc',
      prompt: 'A short video of a training room', duration: 4, aspectRatio: '16:9',
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.jobId).toBe('paid-job');
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'owner-1',
      jobId: 'paid-job',
      requestId: '12345678-1234-1234-1234-123456789abc',
      startResponse: expect.objectContaining({ jobId: 'paid-job' }),
    }), { merge: true });
  });

  it('prepares English narration for a prompt written in English', async () => {
    mocks.text.mockResolvedValue('See how our practical training saves time.');
    const res = responseRecorder();
    await handler({ method: 'POST', headers: {}, body: {
      action: 'videoNarration', prompt: 'An instructor demonstrating an AI workflow', duration: 8, language: 'English',
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.text).toBe('See how our practical training saves time.');
    expect(mocks.text).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('within 8 seconds') }));
  });
});
