import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyIdToken, mockInitFirebaseAdmin, mockDelete, mockGetCookie, mockDoc, mockGetAutomationAccessToken } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockInitFirebaseAdmin: vi.fn(),
  mockDelete: vi.fn(),
  mockGetCookie: vi.fn(),
  mockDoc: vi.fn(),
  mockGetAutomationAccessToken: vi.fn(),
}));
vi.mock('../../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: mockVerifyIdToken }) },
  initFirebaseAdmin: mockInitFirebaseAdmin,
}));
vi.mock('../../../api/_tiktok.js', () => ({
  getAutomationAccessToken: mockGetAutomationAccessToken,
  getCookie: mockGetCookie,
  sessionCookieAttributes: vi.fn(() => 'HttpOnly; Secure; SameSite=None; Path=/'),
}));

const handler = (await import('../../../api/tiktok/me.js')).default;

const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  mockInitFirebaseAdmin.mockReturnValue({
    collection: () => ({ doc: mockDoc }),
  });
  mockDoc.mockReturnValue({ delete: mockDelete });
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe('GET /api/tiktok/me?action=facebookAutomation', () => {
  it('shows why Facebook cannot be scheduled before the Meta app is configured or a Page is connected', async () => {
    vi.stubEnv('FACEBOOK_APP_ID', '');
    vi.stubEnv('FACEBOOK_APP_SECRET', '');
    vi.stubEnv('APP_URL', 'https://example.com');
    mockVerifyIdToken.mockResolvedValue({ uid: 'company-a' });
    mockDoc.mockReturnValue({ get: async () => ({ exists: false }) });
    const res = response();
    await handler({ method: 'GET', query: { action: 'facebookAutomation' }, headers: { authorization: 'Bearer firebase-token' } }, res);
    expect(res.body).toEqual({ connected: false, pages: [], setupReady: false });
    expect(mockDoc).toHaveBeenCalledWith('company-a');
  });

  it('offers a connected Page even if an older connection has no selected Page ID', async () => {
    vi.stubEnv('FACEBOOK_APP_ID', 'app-id');
    vi.stubEnv('FACEBOOK_APP_SECRET', 'app-secret');
    vi.stubEnv('APP_URL', 'https://example.com');
    mockVerifyIdToken.mockResolvedValue({ uid: 'company-a' });
    mockDoc.mockReturnValue({ get: async () => ({ exists: true, data: () => ({ pages: [{ id: '123', name: 'My Page', accessToken: 'private-token' }] }) }) });
    const res = response();
    await handler({ method: 'GET', query: { action: 'facebookAutomation' }, headers: { authorization: 'Bearer firebase-token' } }, res);
    expect(res.body).toEqual({ connected: true, setupReady: true, pages: [{ id: '123', name: 'My Page' }], selectedPageId: '123' });
  });
});

describe('POST /api/tiktok/me?action=disconnect', () => {
  it('rejects a request with no Authorization header', async () => {
    const req = { method: 'POST', query: { action: 'disconnect' }, headers: {} };
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects a request with an invalid Firebase ID token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'));
    const req = { method: 'POST', query: { action: 'disconnect' }, headers: { authorization: 'Bearer bad-token' } };
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('clears only the signed-in owner connection', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockGetCookie.mockImplementation((_req, name) => name === 'tiktok_owner' ? 'user-1' : 'token');
    const req = { method: 'POST', query: { action: 'disconnect' }, headers: { authorization: 'Bearer good-token' } };
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDoc).toHaveBeenCalledWith('user-1');
    expect(res.headers['Set-Cookie'][0]).toContain('tiktok_token=;');
  });

  it('cannot disconnect another profile connection on the same browser', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-2' });
    mockGetCookie.mockReturnValue('user-1');
    const res = response();
    await handler({ method: 'POST', query: { action: 'disconnect' }, headers: { authorization: 'Bearer good-token' } }, res);
    expect(res.statusCode).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('GET /api/tiktok/me?action=automation', () => {
  it('checks only the signed-in owner token without returning it', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'company-a' });
    mockGetAutomationAccessToken.mockResolvedValue('private-access-token');
    const res = response();
    await handler({ method: 'GET', query: { action: 'automation' }, headers: { authorization: 'Bearer firebase-token' } }, res);
    expect(mockGetAutomationAccessToken).toHaveBeenCalledWith(expect.anything(), 'company-a');
    expect(res.body).toEqual({ connected: true });
  });

  it('reports an account with no connection as disconnected', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'company-b' });
    mockGetAutomationAccessToken.mockResolvedValue(null);
    const res = response();
    await handler({ method: 'GET', query: { action: 'automation' }, headers: { authorization: 'Bearer firebase-token' } }, res);
    expect(res.body).toEqual({ connected: false });
  });
});

describe('TikTok statistics route shared with /api/tiktok/me', () => {
  it('requires the signed-in owner for the existing stats URL', async () => {
    const res = response();
    await handler({ method: 'GET', query: { route: 'stats' }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('auth_required');
  });

  it('preserves the videos action on the stats URL', async () => {
    const res = response();
    await handler({ method: 'GET', query: { route: 'stats', action: 'videos' }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Sign in to view TikTok videos.');
  });
});
