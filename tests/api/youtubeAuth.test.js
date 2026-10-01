import { expect, it, vi } from 'vitest';

vi.mock('../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: async () => ({ uid: 'owner' }) }) },
  initFirebaseAdmin: () => ({}),
}));
vi.mock('../../api/_tiktok.js', () => ({
  createOAuthState: () => 'state',
  getRedirectUri: () => 'https://app.example/callback',
  getTikTokAuthUrl: () => 'https://tiktok.example/auth',
  oauthStateCookieHeader: () => 'state=state',
  oauthOwnerCookieHeader: () => 'owner=owner',
}));
vi.mock('../../api/_youtube.js', () => ({
  getYouTubeAuthUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
  getYouTubeRedirectUri: () => 'https://app.example/callback',
  youtubeOwnerCookieHeader: () => { throw new Error('YOUTUBE_CLIENT_SECRET is not configured.'); },
}));

import handler from '../../api/auth/tiktok.js';

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  setHeader() {},
  json(body) { this.body = body; return this; },
});

it('reports missing YouTube OAuth configuration as a service error after sign-in', async () => {
  const res = response();
  await handler({ query: { provider: 'youtube' }, headers: { authorization: 'Bearer valid' } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body.error).toContain('YOUTUBE_CLIENT_SECRET');
});

it('asks for YouTube sign-in when the owner token is missing', async () => {
  const res = response();
  await handler({ query: { provider: 'youtube' }, headers: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(res.body.error).toContain('YouTube');
});
