import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  checkRateLimit: vi.fn(),
  get: vi.fn(),
  getStart: vi.fn(),
  createStart: vi.fn(),
  setStart: vi.fn(),
  deleteStart: vi.fn(),
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
    collection: (name) => name === 'video_starts' ? ({
      doc: () => ({ get: mocks.getStart, create: mocks.createStart, set: mocks.setStart, delete: mocks.deleteStart }),
    }) : ({
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
    mocks.getStart.mockResolvedValue({ exists: false });
    mocks.createStart.mockResolvedValue(undefined);
    mocks.setStart.mockResolvedValue(undefined);
    mocks.deleteStart.mockResolvedValue(undefined);
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
    mocks.getStart.mockResolvedValue({ exists: true, data: () => ({
      userId: 'owner-1', startedAt: { toMillis: () => Date.now() },
    }) });
    mocks.get.mockResolvedValue({ docs: [] });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: { action: 'videoRecover', requestId: '12345678-1234-1234-1234-123456789abc' } }, res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ status: 'starting' });
  });

  it('identifies a request that never reached the server so its ID can be resubmitted safely', async () => {
    mocks.get.mockResolvedValue({ docs: [] });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: {
      action: 'videoRecover', requestId: '12345678-1234-1234-1234-123456789abc',
    } }, res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ status: 'not-found' });
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
    expect(mocks.createStart).toHaveBeenCalledWith(expect.objectContaining({ status: 'PREPARING', userId: 'owner-1' }));
    expect(mocks.setStart).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'paid-job', status: 'PROCESSING' }), { merge: true });
  });

  it('clears a provider-rejected start so a retry cannot get stranded', async () => {
    mocks.startVideo.mockRejectedValue(Object.assign(new Error('HTTP 400: provider image rejection'), {
      statusCode: 400,
      providerCode: 'InputImageSensitiveContentDetected.PrivacyInformation',
    }));
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: {
      action: 'videoGenerate', requestId: '12345678-1234-1234-1234-123456789abc',
      prompt: 'A short video of a training room', duration: 4, aspectRatio: '16:9',
    } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/remove or replace the starting image/i);
    expect(res.body.error).not.toContain('HTTP 400');
    expect(mocks.deleteStart).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not start a second paid job for the same request while the first is preparing', async () => {
    mocks.createStart.mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }));
    const request = {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: {
        action: 'videoGenerate', requestId: '12345678-1234-1234-1234-123456789abc',
        prompt: 'A short video of a training room', duration: 4, aspectRatio: '16:9',
      },
    };
    // Capture the request hash from the successful reservation shape.
    const first = responseRecorder();
    mocks.startVideo.mockResolvedValue({ jobId: 'paid-job' });
    mocks.createStart.mockResolvedValueOnce(undefined);
    await handler(request, first);
    const reservation = mocks.createStart.mock.calls[0][0];
    mocks.getStart.mockResolvedValue({ exists: true, data: () => reservation });
    mocks.startVideo.mockClear();
    const second = responseRecorder();
    await handler(request, second);
    expect(second.statusCode).toBe(202);
    expect(second.body).toEqual({ status: 'starting' });
    expect(mocks.startVideo).not.toHaveBeenCalled();
  });

  it('returns the first paid job when the same start request is repeated', async () => {
    const request = {
      method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: {
        action: 'videoGenerate', requestId: '12345678-1234-1234-1234-123456789abc',
        prompt: 'A short video of a training room', duration: 4, aspectRatio: '16:9',
      },
    };
    mocks.startVideo.mockResolvedValue({ jobId: 'paid-job' });
    const first = responseRecorder();
    await handler(request, first);
    const reservation = mocks.createStart.mock.calls[0][0];
    mocks.createStart.mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }));
    mocks.getStart.mockResolvedValue({ exists: true, data: () => ({
      ...reservation, startResponse: first.body,
    }) });
    mocks.startVideo.mockClear();
    const second = responseRecorder();
    await handler(request, second);

    expect(second.statusCode).toBe(200);
    expect(second.body.jobId).toBe('paid-job');
    expect(mocks.startVideo).not.toHaveBeenCalled();
  });

  it('returns an interrupted start clearly without silently submitting another paid job', async () => {
    mocks.getStart.mockResolvedValue({ exists: true, data: () => ({
      userId: 'owner-1', startedAt: { toMillis: () => Date.now() - 11 * 60 * 1000 },
    }) });
    mocks.get.mockResolvedValue({ docs: [] });
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-token' }, body: {
      action: 'videoRecover', requestId: '12345678-1234-1234-1234-123456789abc',
    } }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toMatch(/avoid a duplicate charge/i);
    expect(mocks.startVideo).not.toHaveBeenCalled();
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
