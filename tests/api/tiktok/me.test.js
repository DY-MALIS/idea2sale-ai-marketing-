import { afterEach, describe, expect, it, vi } from 'vitest';

const { mockVerifyIdToken, mockInitFirebaseAdmin, mockDelete } = vi.hoisted(() => ({
  mockVerifyIdToken: vi.fn(),
  mockInitFirebaseAdmin: vi.fn(),
  mockDelete: vi.fn(),
}));
vi.mock('../../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: mockVerifyIdToken }) },
  initFirebaseAdmin: mockInitFirebaseAdmin,
}));
vi.mock('../../../api/_tiktok.js', () => ({ getCookie: vi.fn() }));

const handler = (await import('../../../api/tiktok/me.js')).default;

const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; return this; },
});

afterEach(() => {
  vi.resetAllMocks();
  mockInitFirebaseAdmin.mockReturnValue({
    collection: () => ({ doc: () => ({ delete: mockDelete }) }),
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

  it('clears the shared automation connection for a signed-in user', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    const req = { method: 'POST', query: { action: 'disconnect' }, headers: { authorization: 'Bearer good-token' } };
    const res = response();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockDelete).toHaveBeenCalled();
    expect(res.headers['Set-Cookie']).toContain('tiktok_token=;');
  });
});
