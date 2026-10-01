import { expect, it, vi } from 'vitest';

const { saveTokens, readOwner } = vi.hoisted(() => ({ saveTokens: vi.fn(), readOwner: vi.fn() }));
vi.mock('../../api/_tiktok.js', () => ({
  verifyAndClearOAuthState: () => true,
  readOAuthOwner: vi.fn(),
  getRedirectUri: vi.fn(),
}));
vi.mock('../../api/_youtube.js', () => ({
  getYouTubeRedirectUri: () => 'https://app.example.com/api/tiktok/callback?provider=youtube',
  exchangeYouTubeCode: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }),
  saveYouTubeAutomationTokens: saveTokens,
  readYouTubeOAuthOwner: readOwner,
}));
vi.mock('../../api/_firebaseAdmin.js', () => ({ initFirebaseAdmin: () => ({}) }));

const { default: handler } = await import('../../api/tiktok/callback.js');

it('does not report a successful YouTube connection when token storage fails', async () => {
  readOwner.mockReturnValue('user-one');
  saveTokens.mockRejectedValue(new Error('Firestore unavailable'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ items: [] }) })));
  const res = {
    statusCode: 200,
    headers: {},
    getHeader(name) { return this.headers[name]; },
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body) { this.body = body; return this; },
  };
  await handler({ query: { code: 'code', provider: 'youtube' } }, res);
  expect(res.statusCode).toBe(500);
  expect(res.body).toContain('Firestore unavailable');
  expect(res.body).not.toContain('YOUTUBE_AUTH_SUCCESS');
  vi.unstubAllGlobals();
});
