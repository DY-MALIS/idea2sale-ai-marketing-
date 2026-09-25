import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockPollOpenRouterVideo } = vi.hoisted(() => ({ mockPollOpenRouterVideo: vi.fn() }));
const { mockVerifySpeech } = vi.hoisted(() => ({ mockVerifySpeech: vi.fn().mockResolvedValue({ passed: true }) }));
const { mockMux } = vi.hoisted(() => ({ mockMux: vi.fn().mockResolvedValue('data:video/mp4;base64,bXV4ZWQ=') }));
vi.mock('../../../api/_videoNarrationMux.js', () => ({ replaceVideoNarration: mockMux }));
vi.mock('../../../api/_videoSpeech.js', () => ({ verifyUploadedVideoSpeech: mockVerifySpeech }));
vi.mock('../../../api/_openrouter.js', () => ({ pollOpenRouterVideo: mockPollOpenRouterVideo }));
const narrationMocks = vi.hoisted(() => ({ script: vi.fn(), speech: vi.fn() }));
vi.mock('../../../api/_khmerNarration.js', () => ({
  createKhmerNarration: narrationMocks.script,
  generateKhmerSpeech: narrationMocks.speech,
}));

const { mockScheduleContentPlanPoll, mockUploadMediaDataUrl, mockResolveTelegramDestination } = vi.hoisted(() => ({
  mockScheduleContentPlanPoll: vi.fn(),
  mockUploadMediaDataUrl: vi.fn(),
  mockResolveTelegramDestination: vi.fn(),
}));
vi.mock('../../../api/telegram/run-scheduled.js', () => ({
  TELEGRAM_CAPTION_LIMIT: 1024,
  formatTelegramHtml: (value) => String(value || ''),
  truncateForTelegram: (value) => String(value || ''),
  initFirebaseAdmin: vi.fn(),
  sendTelegram: vi.fn(),
  scheduleContentPlanPoll: mockScheduleContentPlanPoll,
  uploadMediaDataUrl: mockUploadMediaDataUrl,
  applyImageKitLogoOverlay: (url) => url,
  resolveTelegramDestination: mockResolveTelegramDestination,
}));
vi.mock('../../../api/_telegramClaim.js', () => ({ claimPendingPost: vi.fn(), findRecentDuplicateTelegramPost: vi.fn() }));
vi.mock('../../../api/_alert.js', () => ({ notifyAdmins: vi.fn() }));

const { getRawBody, processContentPlanVideo } = await import('../../../api/telegram/deliver.js');

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

const fakeDoc = (data, updateSpy) => ({
  async get() { return { exists: data !== undefined, data: () => data }; },
  async update(patch) { updateSpy?.(patch); },
});

const fakeDb = (data, updateSpy) => ({
  collection: () => ({ doc: () => fakeDoc(data, updateSpy) }),
  async runTransaction(fn) {
    return fn({
      get: (ref) => ref.get(),
      update: (ref, patch) => { ref.update(patch); },
    });
  },
});

describe('QStash raw request body', () => {
  it('uses the exact body captured by Express before JSON parsing', async () => {
    await expect(getRawBody({ rawBody: '{"postId":"abc"}', body: { postId: 'changed' } }))
      .resolves.toBe('{"postId":"abc"}');
  });

  it('does not hang if another middleware already consumed the stream', async () => {
    await expect(getRawBody({ readableEnded: true, body: { postId: 'abc' } }))
      .resolves.toBe('{"postId":"abc"}');
  });
});

describe('processContentPlanVideo', () => {
  it('never sends the generated voice if narration assembly fails', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'raw' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded' });
    mockMux.mockRejectedValueOnce(new Error('Narration assembly failed'));
    global.fetch = vi.fn();
    const result = await processContentPlanVideo(fakeDb({
      status: 'PROCESSING', videoJobId: 'job', voiceOverMode: 'edge-seedance',
      prompt: 'Presenter', voiceOverText: 'សួស្តី',
      narrationAudio: { filePath: '/voice.mp3', mediaUrl: 'original-audio', duration: 5 },
    }), 'item', {});
    expect(result.ok).toBe(false);
    expect(mockVerifySpeech).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('auto-posts the exact Edge reference track used for lip sync', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'raw' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ ok: true }) });
    const result = await processContentPlanVideo(fakeDb({
      status: 'PROCESSING', videoJobId: 'job', voiceOverMode: 'edge-seedance',
      prompt: 'Presenter', voiceOverText: 'សួស្តី',
      narrationAudio: { filePath: '/telegram-media/original-reference.mp3', mediaUrl: 'original-audio', duration: 5.2 },
    }), 'item', {});
    expect(result.ok).toBe(true);
    expect(narrationMocks.speech).not.toHaveBeenCalled();
    expect(mockMux).toHaveBeenCalledWith('uploaded', 'original-audio');
    expect(mockUploadMediaDataUrl).toHaveBeenLastCalledWith({ mediaDataUrl: 'data:video/mp4;base64,bXV4ZWQ=', mediaType: 'video' });
    expect(mockVerifySpeech).toHaveBeenCalledWith('uploaded', 'សួស្តី');
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockResolveTelegramDestination).toHaveBeenCalled();
    expect(global.fetch.mock.calls[0][0]).toContain('/sendVideo');
  });

  it.each([undefined, { filePath: '/voice.mp3', duration: 8.3 }])('rejects missing or overlong Edge reference audio', async (narrationAudio) => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'raw' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded' });
    global.fetch = vi.fn();
    const result = await processContentPlanVideo(fakeDb({
      status: 'PROCESSING', videoJobId: 'job', voiceOverMode: 'edge-seedance',
      prompt: 'Presenter', voiceOverText: 'សួស្តី', narrationAudio,
    }), 'item', {});
    expect(result.ok).toBe(false);
    expect(narrationMocks.speech).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retains mismatched speech and blocks scheduled delivery', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'native-video' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded-native-video' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    mockVerifySpeech.mockRejectedValueOnce(Object.assign(new Error('Speech mismatch'), { speechVerification: { passed: false, similarity: 0.4 } }));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const updates = [];
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', prompt: 'Khmer dialogue', voiceOverText: 'សួស្តី' }, p => updates.push(p)), 'item', {});
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(updates).toContainEqual({ speechVerification: { passed: false, similarity: 0.4 } });
    expect(updates.at(-1)).toMatchObject({ status: 'FAILED' });
  });
  it('keeps a generated video for review when transcription infrastructure is unavailable', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'native-video' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded-native-video' });
    mockVerifySpeech.mockRejectedValueOnce(Object.assign(new Error('Verification unavailable'), {
      verificationUnavailable: true,
      speechVerification: { passed: false, unavailable: true },
    }));
    global.fetch = vi.fn();
    const updates = [];
    const result = await processContentPlanVideo(fakeDb({
      status: 'PROCESSING', videoJobId: 'job', prompt: 'Khmer dialogue', voiceOverText: 'សួស្តី',
    }, p => updates.push(p)), 'item', {});
    expect(result).toMatchObject({ ok: false, reviewRequired: true });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'REVIEW', speechVerification: { unavailable: true } });
  });
  it('skips sending when a concurrent/duplicate invocation already claimed delivery', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'native-video' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded-native-video' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const result = await processContentPlanVideo(fakeDb({
      status: 'PROCESSING', videoJobId: 'job', prompt: 'Natural Khmer dialogue', voiceOverWanted: true,
      deliveryClaimedAt: { toMillis: () => Date.now() },
    }), 'item', {});
    expect(result).toEqual({ ok: true, skipped: 'already-sending' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockResolveTelegramDestination).not.toHaveBeenCalled();
  });
  it('preserves and auto-posts native Veo speech for Khmer calendar videos by default', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'native-video' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded-native-video' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', prompt: 'Natural Khmer dialogue', voiceOverWanted: true }), 'item', {});
    expect(result.ok).toBe(true);
    expect(narrationMocks.speech).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/sendVideo');
  });
  it('rejects legacy separate-audio jobs that cannot preserve lip sync after migration', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'raw' });
    mockUploadMediaDataUrl.mockResolvedValueOnce({ mediaUrl: 'uploaded' }).mockResolvedValueOnce({ filePath: '/voice.mp3' });
    narrationMocks.script.mockResolvedValue('សួស្តី');
    narrationMocks.speech.mockResolvedValue({ audioUrl: 'khmer-audio', duration: 4 });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ ok: true }) });
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', voiceOverMode: 'separate', prompt: 'A presenter says in Khmer: សួស្តី' }), 'item', {});
    expect(result.ok).toBe(false);
    expect(narrationMocks.speech).toHaveBeenCalledWith(expect.objectContaining({ input: 'សួស្តី', voice: 'nova' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not send the native video when Khmer speech fails', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'raw' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded' });
    narrationMocks.script.mockRejectedValue(new Error('Khmer narration failed'));
    global.fetch = vi.fn();
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', voiceOverMode: 'separate', prompt: 'Product' }), 'item', {});
    expect(result.ok).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('does nothing for an item that is no longer PROCESSING (idempotent against duplicate QStash delivery)', async () => {
    const db = fakeDb({ status: 'DONE', videoJobId: 'job-1' });
    const result = await processContentPlanVideo(db, 'item-1', {});
    expect(result).toEqual({ ok: true, skipped: 'not-processing' });
    expect(mockPollOpenRouterVideo).not.toHaveBeenCalled();
  });

  it('re-schedules another poll when the video job is still running', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ status: 'processing' });
    const updates = [];
    const db = fakeDb({ status: 'PROCESSING', videoJobId: 'job-1', pollAttempts: 3, userId: 'u1' }, (p) => updates.push(p));

    const result = await processContentPlanVideo(db, 'item-1', { headers: { host: 'app.example' } });

    expect(result.stillProcessing).toBe(true);
    expect(updates[0]).toEqual({ pollAttempts: 4 });
    expect(updates[1]).toMatchObject({ pollSchedulingError: null });
    expect(mockScheduleContentPlanPoll).toHaveBeenCalledWith({ headers: { host: 'app.example' } }, 'item-1');
  });

  it('keeps a paid job PROCESSING when scheduling its next poll fails', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ status: 'processing' });
    mockScheduleContentPlanPoll.mockRejectedValueOnce(new Error('QStash unavailable'));
    const updates = [];
    const db = fakeDb({ status: 'PROCESSING', videoJobId: 'job-1', pollAttempts: 2, userId: 'u1' }, (p) => updates.push(p));

    const result = await processContentPlanVideo(db, 'item-1', { headers: { host: 'app.example' } });

    expect(result).toMatchObject({ ok: true, stillProcessing: true, pollingDeferred: true, attempts: 3 });
    expect(updates).not.toContainEqual(expect.objectContaining({ status: 'FAILED' }));
    expect(updates.at(-1)).toMatchObject({ pollSchedulingError: 'QStash unavailable' });
  });

  it('fails the item once the poll-attempt limit is reached instead of polling forever', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ status: 'processing' });
    const updates = [];
    const db = fakeDb({ status: 'PROCESSING', videoJobId: 'job-1', pollAttempts: 39, userId: 'u1' }, (p) => updates.push(p));

    const result = await processContentPlanVideo(db, 'item-1', {});

    expect(result.ok).toBe(false);
    expect(mockScheduleContentPlanPoll).not.toHaveBeenCalled();
    expect(updates[0].status).toBe('FAILED');
    expect(updates[0].errorMessage).toMatch(/timed out/i);
  });

  it('delivers the finished video to Telegram and marks the item DONE', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'data:video/mp4;base64,AAAA' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'https://ik.imagekit.io/demo/telegram-media/foo.mp4' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'bot-token', chatId: '-100123' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) });
    const updates = [];
    const db = fakeDb({ status: 'PROCESSING', videoJobId: 'job-1', userId: 'u1', topic: 'Summer sale' }, (p) => updates.push(p));

    const result = await processContentPlanVideo(db, 'item-1', {});

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/sendVideo'),
      expect.objectContaining({ method: 'POST' }),
    );
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.chat_id).toBe('-100123');
    expect(sentBody.video).toBe('https://ik.imagekit.io/demo/telegram-media/foo.mp4');
    expect(updates.at(-1)).toMatchObject({ status: 'DONE', resultMediaUrl: 'https://ik.imagekit.io/demo/telegram-media/foo.mp4' });
  });

  it('fails the item if no Telegram destination is connected', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'data:video/mp4;base64,AAAA' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'https://ik.imagekit.io/demo/telegram-media/foo.mp4' });
    mockResolveTelegramDestination.mockResolvedValue({ token: '', chatId: '' });
    const updates = [];
    const db = fakeDb({ status: 'PROCESSING', videoJobId: 'job-1', userId: 'u1' }, (p) => updates.push(p));

    const result = await processContentPlanVideo(db, 'item-1', {});

    expect(result.ok).toBe(false);
    expect(updates.at(-1).status).toBe('FAILED');
  });
});
