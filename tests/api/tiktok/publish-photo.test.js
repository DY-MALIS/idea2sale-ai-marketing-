import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { verifyIdToken, getAutomationAccessToken, recordTikTokPostSync } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getAutomationAccessToken: vi.fn(),
  recordTikTokPostSync: vi.fn(),
}));

vi.mock('../../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken }) },
  initFirebaseAdmin: () => ({}),
}));
vi.mock('../../../api/_tiktok.js', () => ({ getAutomationAccessToken, recordTikTokPostSync }));
vi.mock('../../../api/_audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('../../../api/_imagekitUpload.js', () => ({ uploadMediaDataUrl: vi.fn() }));

const handler = (await import('../../../api/tiktok/publish-photo.js')).default;
const response = () => ({
  statusCode: 200,
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  verifyIdToken.mockResolvedValue({ uid: 'owner-1' });
  getAutomationAccessToken.mockResolvedValue('saved-token');
  vi.stubEnv('TIKTOK_POST_MODE', 'inbox');
});

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('publishes a photo using the saved owner connection without TikTok cookies', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { publish_id: 'photo-1' }, error: { code: 'ok' } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const res = response();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer firebase-token' },
    body: { imageUrl: 'https://cdn.example.com/photo.png', title: 'Poster' },
  }, res);
  expect(res.statusCode).toBe(200);
  expect(getAutomationAccessToken).toHaveBeenCalledWith({}, 'owner-1');
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer saved-token');
  expect(res.body.publishId).toBe('photo-1');
});

it('does not publish when the signed-in owner has no saved connection', async () => {
  getAutomationAccessToken.mockResolvedValue(null);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer firebase-token' }, body: {} }, res);
  expect(res.statusCode).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});
