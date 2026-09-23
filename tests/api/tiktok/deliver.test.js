import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockVerify, mockGetAutomationAccessToken, mockDeliverOne, mockNotifyAdmins, mockInitFirebaseAdmin } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockGetAutomationAccessToken: vi.fn(),
  mockDeliverOne: vi.fn(),
  mockNotifyAdmins: vi.fn(),
  mockInitFirebaseAdmin: vi.fn(),
}));

vi.mock('@upstash/qstash', () => ({
  // Vitest requires a constructible function here (arrow functions can't be
  // `new`-ed, which the real code does: `new Receiver({...})`).
  Receiver: vi.fn().mockImplementation(function Receiver() { this.verify = mockVerify; }),
}));
vi.mock('../../../api/_firebaseAdmin.js', () => ({ initFirebaseAdmin: mockInitFirebaseAdmin }));
vi.mock('../../../api/_tiktok.js', () => ({ getAutomationAccessToken: mockGetAutomationAccessToken }));
vi.mock('../../../api/tiktok/publish.js', () => ({ deliverOneScheduledTikTokPost: mockDeliverOne }));
vi.mock('../../../api/_alert.js', () => ({ notifyAdmins: mockNotifyAdmins }));

const handler = (await import('../../../api/tiktok/deliver.js')).default;

const response = () => ({
  statusCode: 200,
  body: undefined,
  setHeader() {},
  status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; return this; },
});

const request = (body, headerOverrides = {}) => ({
  method: 'POST',
  headers: { 'upstash-signature': 'sig', ...headerOverrides },
  rawBody: JSON.stringify(body),
  body,
});

beforeEach(() => {
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'current';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
  mockInitFirebaseAdmin.mockReturnValue({ collection: () => ({ doc: () => ({ id: 'post-1' }) }) });
});

afterEach(() => {
  // resetAllMocks would also wipe Receiver's constructor mockImplementation
  // (set once above, outside any test) instead of just clearing call history,
  // breaking every test after the first with a silent "verify() throws" ->
  // 401 no matter what mockVerify is configured to return.
  vi.clearAllMocks();
  delete process.env.QSTASH_CURRENT_SIGNING_KEY;
  delete process.env.QSTASH_NEXT_SIGNING_KEY;
});

describe('POST /api/tiktok/deliver', () => {
  it('rejects a request with no QStash signature', async () => {
    const res = response();
    await handler(request({ postId: 'post-1' }, { 'upstash-signature': undefined }), res);
    expect(res.statusCode).toBe(401);
    expect(mockDeliverOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid QStash signature', async () => {
    mockVerify.mockResolvedValue(false);
    const res = response();
    await handler(request({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(401);
    expect(mockDeliverOne).not.toHaveBeenCalled();
  });

  it('delivers the post and returns the result when the signature is valid', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue('token-1');
    mockDeliverOne.mockResolvedValue({ ok: true, publishId: 'pub-1' });
    const res = response();
    await handler(request({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, publishId: 'pub-1' });
    expect(mockDeliverOne).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'token-1');
  });

  it('notifies admins and reports the failure when delivery fails', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue('token-1');
    mockDeliverOne.mockResolvedValue({ ok: false, error: 'boom' });
    const res = response();
    await handler(request({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, error: 'boom' });
    expect(mockNotifyAdmins).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('skips without publishing when TikTok automation was never connected', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue(null);
    const res = response();
    await handler(request({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, skipped: 'not_connected' });
    expect(mockDeliverOne).not.toHaveBeenCalled();
  });

  it('requires a postId', async () => {
    mockVerify.mockResolvedValue(true);
    const res = response();
    await handler(request({}), res);
    expect(res.statusCode).toBe(400);
  });
});
