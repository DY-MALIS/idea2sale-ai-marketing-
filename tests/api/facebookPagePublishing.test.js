import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeFacebookCode, publishFacebookReel } from '../../api/_facebook.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });

describe('Facebook Page publishing', () => {
  it('exchanges a user code and keeps only Pages with content permission', async () => {
    vi.stubEnv('FACEBOOK_APP_ID', 'app-id');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'app-secret');
    vi.stubEnv('APP_URL', 'https://example.com');
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply({ access_token: 'short-token' }))
      .mockResolvedValueOnce(reply({ access_token: 'long-token' }))
      .mockResolvedValueOnce(reply({ data: [
        { id: '123', name: 'My Page', access_token: 'page-token', tasks: ['PROFILE_PLUS_CREATE_CONTENT'] },
        { id: '456', name: 'Other Page', access_token: 'other-token', tasks: ['PROFILE_PLUS_ANALYZE'] },
      ] }));
    vi.stubGlobal('fetch', fetch);

    const pages = await exchangeFacebookCode('auth-code');
    expect(pages.map(page => page.id)).toEqual(['123']);
    expect(String(fetch.mock.calls[0][0])).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fapi%2Ftiktok%2Fcallback%3Fprovider%3Dfacebook');
    expect(String(fetch.mock.calls[2][0])).toContain('access_token=long-token');
  });

  it('creates, uploads, and finishes a hosted Page Reel', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply({ video_id: '789' }))
      .mockResolvedValueOnce(reply({ success: true }))
      .mockResolvedValueOnce(reply({ success: true }));
    vi.stubGlobal('fetch', fetch);

    const id = await publishFacebookReel('page-token', 'https://cdn.example.com/video.mp4', 'Khmer caption');
    expect(id).toBe('789');
    expect(String(fetch.mock.calls[0][0])).toContain('/me/video_reels?');
    expect(fetch.mock.calls[1][0]).toContain('/video-upload/');
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ Authorization: 'OAuth page-token', file_url: 'https://cdn.example.com/video.mp4' });
    expect(String(fetch.mock.calls[2][0])).toContain('video_state=PUBLISHED');
    expect(String(fetch.mock.calls[2][0])).toContain('description=Khmer+caption');
  });

  it('rejects an inaccessible video before opening an upload session', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(publishFacebookReel('page-token', 'data:video/mp4;base64,AA==', 'caption'))
      .rejects.toThrow('publicly accessible HTTPS');
    expect(fetch).not.toHaveBeenCalled();
  });
});
