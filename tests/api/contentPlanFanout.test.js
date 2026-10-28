import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  pages: vi.fn(), facebookQueue: vi.fn(), youtubeQueue: vi.fn(), tiktokQueue: vi.fn(),
}));
vi.mock('../../api/_facebook.js', () => ({ getFacebookPages: mock.pages, scheduleFacebookQStashDelivery: mock.facebookQueue }));
vi.mock('../../api/_youtube.js', () => ({ scheduleYouTubeQStashDelivery: mock.youtubeQueue }));
vi.mock('../../api/_tiktok.js', () => ({ scheduleTikTokQStashDelivery: mock.tiktokQueue }));
const { queueContentPlanDestinations } = await import('../../api/_contentPlanFanout.js');

const fakeDb = (item) => {
  const posts = new Map();
  const itemRef = { kind: 'item', get: async () => ({ exists: true, data: () => item }) };
  const db = {
    collection: (name) => name === 'content_plan_items'
      ? { doc: () => itemRef }
      : { doc: (id) => ({ id }) },
    runTransaction: async (callback) => callback({
      get: async (ref) => ref.kind === 'item'
        ? { exists: true, data: () => item }
        : { exists: posts.has(ref.id) },
      create: (ref, data) => posts.set(ref.id, data),
    }),
  };
  return { db, posts };
};

describe('Content Plan publishing', () => {
  beforeEach(() => {
    mock.pages.mockReset().mockResolvedValue({ selectedPageId: '123' });
    mock.facebookQueue.mockReset().mockResolvedValue(true);
    mock.youtubeQueue.mockReset().mockResolvedValue(true);
    mock.tiktokQueue.mockReset().mockResolvedValue(true);
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
});
