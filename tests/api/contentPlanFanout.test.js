import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  pages: vi.fn(), facebookQueue: vi.fn(), youtubeQueue: vi.fn(), tiktokQueue: vi.fn(), telegramQueue: vi.fn(),
}));
vi.mock('../../api/_facebook.js', () => ({ getFacebookPages: mock.pages, scheduleFacebookQStashDelivery: mock.facebookQueue }));
vi.mock('../../api/_youtube.js', () => ({ scheduleYouTubeQStashDelivery: mock.youtubeQueue }));
vi.mock('../../api/_tiktok.js', () => ({ scheduleTikTokQStashDelivery: mock.tiktokQueue }));
vi.mock('../../api/telegram/run-scheduled.js', () => ({ scheduleQStashDelivery: mock.telegramQueue }));
const { queueContentPlanDestinations } = await import('../../api/_contentPlanFanout.js');

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const fakeDb = (item, profile = {}, link = null, botProfile = {}) => {
  const posts = new Map();
  const itemRef = {
    kind: 'item', get: async () => ({ exists: true, data: () => item }),
    update: async (patch) => Object.assign(item, patch),
  };
  const db = {
    collection: (name) => name === 'content_plan_items'
      ? { doc: () => itemRef }
      : name === 'business_profiles' ? { doc: (id) => ({ get: async () => ({ data: () => id === item.userId ? profile : botProfile }) }) }
      : name === 'telegram_approval_links' ? { doc: () => ({ get: async () => ({ data: () => link }) }) }
      : name === 'telegram_approval_chats' ? { doc: () => ({ get: async () => ({ data: () => link ? { uid: item.userId, botOwnerId: link.botOwnerId, chatId: link.chatId } : null }) }) }
      : { doc: (id) => ({ id }) },
    runTransaction: async (callback) => callback({
      get: async (ref) => ref.kind === 'item'
        ? { exists: true, data: () => item }
        : { exists: posts.has(ref.id), data: () => posts.get(ref.id) },
      create: (ref, data) => posts.set(ref.id, data),
    }),
  };
  return { db, posts, item };
};

describe('Content Plan publishing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [
      { status: 'creator', user: { id: 123 } },
      { status: 'administrator', can_post_messages: true, user: { id: 456, username: 'dgacademy_official_bot' } },
    ] }) }));
    mock.pages.mockReset().mockResolvedValue({ selectedPageId: '123' });
    mock.facebookQueue.mockReset().mockResolvedValue(true);
    mock.youtubeQueue.mockReset().mockResolvedValue(true);
    mock.tiktokQueue.mockReset().mockResolvedValue(true);
    mock.telegramQueue.mockReset().mockResolvedValue(true);
  });

  it('queues an image only for Facebook, leaving Telegram to its existing sender', async () => {
    const { db, posts } = fakeDb({ userId: 'owner', type: 'image', status: 'PROCESSING', autoPublishDestinations: true, topic: 'Photo' });
    const result = await queueContentPlanDestinations(db, 'image-1', 'https://example.com/photo.jpg', {});
    expect(result.queued).toEqual(['FACEBOOK']);
    expect([...posts.values()][0]).toMatchObject({ platform: 'FACEBOOK', mediaType: 'photo', publishMode: 'FACEBOOK_PHOTO_AUTO_POST' });
    expect(mock.youtubeQueue).not.toHaveBeenCalled();
    expect(mock.tiktokQueue).not.toHaveBeenCalled();
  });

  it('never queues a video if speech has not passed review', async () => {
    const { db, posts } = fakeDb({ userId: 'owner', type: 'video', status: 'PROCESSING', autoPublishDestinations: true, speechVerification: { passed: false } });
    expect(await queueContentPlanDestinations(db, 'video-1', 'https://example.com/video.mp4', {})).toMatchObject({ skipped: 'speech_not_verified' });
    expect(posts.size).toBe(0);
  });

  it('queues a verified video once per destination', async () => {
    const { db, posts } = fakeDb({
      userId: 'owner', type: 'video', status: 'PROCESSING', autoPublishDestinations: true,
      speechVerification: { passed: true }, tiktokDirectPostConsent: true,
      tiktokCommercialDisclosure: true, tiktokOwnBrand: true, duration: 8, topic: 'Video',
    });
    const first = await queueContentPlanDestinations(db, 'video-2', 'https://example.com/video.mp4', {});
    const second = await queueContentPlanDestinations(db, 'video-2', 'https://example.com/video.mp4', {});
    expect(first.queued).toEqual(['YOUTUBE', 'FACEBOOK', 'TIKTOK']);
    expect(second.queued).toEqual([]);
    expect(posts.size).toBe(3);
    expect(posts.get('plan-video-2-tiktok').directPostOptions).toMatchObject({ consent: true, privacyLevel: 'PUBLIC_TO_EVERYONE', ownBrand: true });
  });

  it('queues a new plan image separately for Telegram and Facebook, both awaiting approval', async () => {
    const { db, posts, item } = fakeDb(
      { userId: 'owner', type: 'image', status: 'PROCESSING', autoPublishDestinations: true, approvalRequired: true, topic: 'Photo' },
      { telegramBotToken: 'owner-token', telegramChannelUrl: '@ownerchannel' },
    );
    mock.telegramQueue.mockImplementation(async () => {
      expect(posts.size).toBe(2);
      expect(item.approvalFanoutReady).toBe(true);
      return true;
    });
    const result = await queueContentPlanDestinations(db, 'image-2', 'https://example.com/photo.jpg', {});
    expect(result.queued).toEqual(['TELEGRAM', 'FACEBOOK']);
    expect(posts.get('plan-image-2-telegram')).toMatchObject({ approvalRequired: true, approvalStatus: 'AWAITING_DUE', platform: 'TELEGRAM', mediaUrl: 'https://example.com/photo.jpg' });
    expect(posts.get('plan-image-2-facebook')).toMatchObject({ approvalRequired: true, approvalStatus: 'AWAITING_DUE' });
    expect(item.approvalFanoutReady).toBe(true);
    expect(mock.telegramQueue).toHaveBeenCalledOnce();
  });

  it('holds an early image approval until the scheduled time', async () => {
    vi.useFakeTimers().setSystemTime('2026-11-09T05:56:00Z');
    const due = '2026-11-09T06:00:00.000Z';
    const { db, posts } = fakeDb({
      userId: 'owner', type: 'image', status: 'PROCESSING', autoPublishDestinations: true,
      approvalRequired: true, topic: 'Photo', approvalDueAt: due,
    });
    await queueContentPlanDestinations(db, 'early-image', 'https://example.com/photo.jpg', {});
    expect(posts.get('plan-early-image-telegram').scheduledTime).toBe(due);
    expect(mock.telegramQueue.mock.calls[0][2].toISOString()).toBe(due);
    expect(mock.facebookQueue.mock.calls[0][1].toISOString()).toBe(due);
  });

  it('queues a slow video approval immediately after media is ready', async () => {
    vi.useFakeTimers().setSystemTime('2026-11-09T06:03:00Z');
    const due = '2026-11-09T06:00:00.000Z';
    const { db, posts } = fakeDb({
      userId: 'owner', type: 'video', status: 'PROCESSING', autoPublishDestinations: true,
      approvalRequired: true, topic: 'Video', approvalDueAt: due, speechVerification: { passed: true },
    });
    await queueContentPlanDestinations(db, 'late-video', 'https://example.com/video.mp4', {});
    expect(posts.get('plan-late-video-telegram').scheduledTime).toBe(due);
    expect(mock.telegramQueue.mock.calls[0][2].toISOString()).toBe('2026-11-09T06:03:01.000Z');
  });

  it('queues a linked account photo for Telegram approval', async () => {
    const { db, posts } = fakeDb(
      { userId: 'customer', type: 'image', status: 'PROCESSING', autoPublishDestinations: true, approvalRequired: true, topic: 'Photo' },
      { telegramBotToken: 'invalid-customer-token', telegramChannelUrl: '@customerchannel' },
      { botOwnerId: 'bot-owner', telegramUserId: '123', chatId: '123' },
      { telegramBotToken: 'shared-token', telegramBotActive: true, telegramBotUsername: 'dgacademy_official_bot' },
    );
    const result = await queueContentPlanDestinations(db, 'image-3', 'https://example.com/photo.jpg', {});
    expect(result.queued).toContain('TELEGRAM');
    expect(posts.get('plan-image-3-telegram')).toMatchObject({ userId: 'customer', platform: 'TELEGRAM', approvalRequired: true });
  });

  it('keeps a new Telegram destination queued while its owner has not linked the bot', async () => {
    const { db, posts } = fakeDb(
      { userId: 'customer', type: 'image', status: 'PROCESSING', autoPublishDestinations: true, approvalRequired: true, topic: 'Photo' },
    );
    const result = await queueContentPlanDestinations(db, 'image-4', 'https://example.com/photo.jpg', {});
    expect(result.queued).toContain('TELEGRAM');
    expect(posts.get('plan-image-4-telegram')).toMatchObject({ status: 'PENDING', approvalRequired: true });
  });
});
