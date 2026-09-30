import { describe, expect, it } from 'vitest';
import { getAutomationAccessToken, oauthOwnerCookieHeader, oauthStateCookieHeader, readOAuthOwner, saveAutomationTokens, sessionCookieAttributes } from '../../../api/_tiktok.js';

describe('TikTok session cookies', () => {
  it('uses a localhost-compatible cookie during local development', () => {
    const req = { headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' } };
    expect(sessionCookieAttributes(req)).toContain('SameSite=Lax');
    expect(sessionCookieAttributes(req)).not.toContain('Secure');
    expect(oauthStateCookieHeader('state', req)).toContain('Max-Age=600');
  });

  it('uses secure cross-site cookies in HTTPS production', () => {
    const req = { headers: { host: 'app.example.com', 'x-forwarded-proto': 'https' } };
    expect(sessionCookieAttributes(req)).toContain('Secure');
    expect(sessionCookieAttributes(req)).toContain('SameSite=None');
  });

  it('binds the OAuth callback to the signed-in owner and state', () => {
    const previousSecret = process.env.TIKTOK_CLIENT_SECRET;
    process.env.TIKTOK_CLIENT_SECRET = 'test-client-secret';
    try {
      const req = { headers: { host: 'localhost:3000', 'x-forwarded-proto': 'http' }, query: { state: 'state-a' } };
      const ownerCookie = oauthOwnerCookieHeader('owner-a', 'state-a', req).split(';')[0];
      const res = { headers: {}, getHeader(name) { return this.headers[name]; }, setHeader(name, value) { this.headers[name] = value; } };
      expect(readOAuthOwner({ ...req, headers: { ...req.headers, cookie: ownerCookie } }, res)).toBe('owner-a');
      expect(res.getHeader('Set-Cookie')).toEqual(expect.arrayContaining([expect.stringContaining('tiktok_oauth_owner=;')]));
      expect(readOAuthOwner({ ...req, query: { state: 'state-b' }, headers: { ...req.headers, cookie: ownerCookie } }, res)).toBeNull();
      expect(readOAuthOwner({ ...req, headers: { ...req.headers, cookie: ownerCookie.replace('owner-a', 'owner-b') } }, res)).toBeNull();
    } finally {
      if (previousSecret === undefined) delete process.env.TIKTOK_CLIENT_SECRET;
      else process.env.TIKTOK_CLIENT_SECRET = previousSecret;
    }
  });

  it('stores and reads scheduled publishing tokens by owner', async () => {
    const documents = new Map();
    const db = {
      collection: (name) => {
        expect(name).toBe('tiktok_automation_tokens');
        return { doc: (id) => ({
          set: async (value) => { documents.set(id, value); },
          get: async () => ({ exists: documents.has(id), data: () => documents.get(id) }),
        }) };
      },
    };
    await saveAutomationTokens(db, { ownerId: 'owner-a', accessToken: 'token-a', expiresIn: 3600 });
    await saveAutomationTokens(db, { ownerId: 'owner-b', accessToken: 'token-b', expiresIn: 3600 });
    expect(await getAutomationAccessToken(db, 'owner-a')).toBe('token-a');
    expect(await getAutomationAccessToken(db, 'owner-b')).toBe('token-b');
    expect(documents.has('default')).toBe(false);
  });
});
