import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getYouTubeAutomationAccessToken,
  readYouTubeOAuthOwner,
  saveYouTubeAutomationTokens,
  youtubeOwnerCookieHeader,
  publishVideoToYouTube,
} from '../../api/_youtube.js';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('uploads the shared video with its actual media type', async () => {
  const upload = vi.fn(async (_url, options) => {
    expect(options.body.toString('utf8')).toContain('Content-Type: video/webm');
    return { ok: true, json: async () => ({ id: 'youtube-video-1', status: { privacyStatus: 'private', uploadStatus: 'uploaded' }, snippet: { channelId: 'channel-1', channelTitle: 'Daily Food' } }) };
  });
  vi.stubGlobal('fetch', upload);
  await expect(publishVideoToYouTube('token', {
    videoBuffer: Buffer.from([1, 2, 3]), mimeType: 'video/webm', title: 'Shared video',
  })).resolves.toEqual({ videoId: 'youtube-video-1', privacyStatus: 'private', uploadStatus: 'uploaded', channelId: 'channel-1', channelTitle: 'Daily Food' });
});


describe('YouTube owner isolation', () => {
  it('binds the OAuth callback to the signed-in owner and rejects a changed state', () => {
    vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'test-secret');
    const issued = youtubeOwnerCookieHeader('user-one', 'state-one', { headers: { host: 'localhost:3000' } });
    const cookie = issued.split(';')[0];
    const res = { getHeader: () => [], setHeader: vi.fn() };
    expect(readYouTubeOAuthOwner({ headers: { host: 'localhost:3000', cookie }, query: { state: 'state-one' } }, res)).toBe('user-one');
    expect(readYouTubeOAuthOwner({ headers: { host: 'localhost:3000', cookie }, query: { state: 'state-two' } }, res)).toBeNull();
  });

  it('stores and reads tokens under each owner rather than a shared document', async () => {
    const docs = new Map();
    const db = { collection: () => ({ doc: (id) => ({
      set: async (value) => docs.set(id, value),
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
    }) }) };
    await saveYouTubeAutomationTokens(db, { ownerId: 'user-one', accessToken: 'one', expiresIn: 3600 });
    await saveYouTubeAutomationTokens(db, { ownerId: 'user-two', accessToken: 'two', expiresIn: 3600 });
    expect([...docs.keys()]).toEqual(['user-one', 'user-two']);
    expect(await getYouTubeAutomationAccessToken(db, 'user-one')).toBe('one');
    expect(await getYouTubeAutomationAccessToken(db, 'user-two')).toBe('two');
  });
});
