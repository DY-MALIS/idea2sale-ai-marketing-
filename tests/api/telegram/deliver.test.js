import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockPollOpenRouterVideo } = vi.hoisted(() => ({ mockPollOpenRouterVideo: vi.fn() }));
const { mockVerifySpeech } = vi.hoisted(() => ({ mockVerifySpeech: vi.fn().mockResolvedValue({ passed: true }) }));
vi.mock('../../../api/_videoSpeech.js', () => ({ verifyUploadedVideoSpeech: mockVerifySpeech }));
vi.mock('../../../api/_openrouter.js', () => ({ pollOpenRouterVideo: mockPollOpenRouterVideo }));
const narrationMocks = vi.hoisted(() => ({ script: vi.fn(), speech: vi.fn(), replace: vi.fn() }));
vi.mock('../../../api/_khmerNarration.js', () => ({
  createKhmerNarration: narrationMocks.script,
  generateKhmerSpeech: narrationMocks.speech,
  replaceCloudinaryAudio: narrationMocks.replace,
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
  resolveTelegramDestination: mockResolveTelegramDestination,
}));
vi.mock('../../../api/_telegramClaim.js', () => ({ claimPendingPost: vi.fn(), findRecentDuplicateTelegramPost: vi.fn() }));
vi.mock('../../../api/_alert.js', () => ({ notifyAdmins: vi.fn() }));

const { processContentPlanVideo } = await import('../../../api/telegram/deliver.js');

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
});

describe('processContentPlanVideo', () => {
  it('records a speech mismatch and still sends the scheduled video', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'native-video' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded-native-video' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    mockVerifySpeech.mockRejectedValueOnce(Object.assign(new Error('Speech mismatch'), { speechVerification: { passed: false, similarity: 0.4 } }));
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const updates = [];
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', prompt: 'Khmer dialogue', voiceOverText: 'សួស្តី' }, p => updates.push(p)), 'item', {});
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
    expect(updates).toContainEqual({ speechVerification: { passed: false, similarity: 0.4 } });
    expect(updates.at(-1)).toMatchObject({ status: 'DONE' });
  });
  it('preserves native Veo speech for Khmer calendar videos by default', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'native-video' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'uploaded-native-video' });
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', prompt: 'Natural Khmer dialogue', voiceOverWanted: true }), 'item', {});
    expect(result.ok).toBe(true);
    expect(narrationMocks.speech).not.toHaveBeenCalled();
    expect(narrationMocks.replace).not.toHaveBeenCalled();
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).video).toBe('uploaded-native-video');
  });
  it('adds Khmer speech before delivering a calendar video', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'raw' });
    mockUploadMediaDataUrl.mockResolvedValueOnce({ mediaUrl: 'uploaded' }).mockResolvedValueOnce({ publicId: 'voice', duration: 4 });
    narrationMocks.script.mockResolvedValue('សួស្តី');
    narrationMocks.speech.mockResolvedValue({ audioUrl: 'khmer-audio' });
    narrationMocks.replace.mockReturnValue('narrated-video');
    mockResolveTelegramDestination.mockResolvedValue({ token: 'token', chatId: 'chat' });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ ok: true }) });
    const result = await processContentPlanVideo(fakeDb({ status: 'PROCESSING', videoJobId: 'job', voiceOverMode: 'separate', prompt: 'A presenter says in Khmer: សួស្តី' }), 'item', {});
    expect(result.ok).toBe(true);
    expect(narrationMocks.speech).toHaveBeenCalledWith(expect.objectContaining({ input: 'សួស្តី', voice: 'nova' }));
    expect(JSON.parse(global.fetch.mock.calls[1][1].body).video).toBe('narrated-video');
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
    expect(updates).toEqual([{ pollAttempts: 4 }]);
    expect(mockScheduleContentPlanPoll).toHaveBeenCalledWith({ headers: { host: 'app.example' } }, 'item-1');
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
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'https://res.cloudinary.com/demo/video/upload/v1/foo.mp4' });
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
    expect(sentBody.video).toBe('https://res.cloudinary.com/demo/video/upload/v1/foo.mp4');
    expect(updates[0]).toMatchObject({ status: 'DONE', resultMediaUrl: 'https://res.cloudinary.com/demo/video/upload/v1/foo.mp4' });
  });

  it('fails the item if no Telegram destination is connected', async () => {
    mockPollOpenRouterVideo.mockResolvedValue({ videoUrl: 'data:video/mp4;base64,AAAA' });
    mockUploadMediaDataUrl.mockResolvedValue({ mediaUrl: 'https://res.cloudinary.com/demo/video/upload/v1/foo.mp4' });
    mockResolveTelegramDestination.mockResolvedValue({ token: '', chatId: '' });
    const updates = [];
    const db = fakeDb({ status: 'PROCESSING', videoJobId: 'job-1', userId: 'u1' }, (p) => updates.push(p));

    const result = await processContentPlanVideo(db, 'item-1', {});

    expect(result.ok).toBe(false);
    expect(updates[0].status).toBe('FAILED');
  });
});
