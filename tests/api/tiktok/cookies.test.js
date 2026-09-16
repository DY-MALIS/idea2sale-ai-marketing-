import { describe, expect, it } from 'vitest';
import { oauthStateCookieHeader, sessionCookieAttributes } from '../../../api/_tiktok.js';

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
});
