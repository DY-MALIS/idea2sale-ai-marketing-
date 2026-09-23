import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetCookie, mockRecordTikTokPostSync, mockVerifyIdToken, mockLogAudit, mockScheduleQstash,
  mockInitFirebaseAdmin, mockGetAutomationAccessToken, mockClaimPendingPost, mockFindRecentDuplicate,
  mockNotifyAdmins, mockVerify,
} = vi.hoisted(() => ({
  mockGetCookie: vi.fn(),
  mockRecordTikTokPostSync: vi.fn(),
  mockVerifyIdToken: vi.fn(),
  mockLogAudit: vi.fn(),
  mockScheduleQstash: vi.fn(),
  mockInitFirebaseAdmin: vi.fn(),
  mockGetAutomationAccessToken: vi.fn(),
  mockClaimPendingPost: vi.fn(),
  mockFindRecentDuplicate: vi.fn(),
  mockNotifyAdmins: vi.fn(),
  mockVerify: vi.fn(),
}));
vi.mock('@upstash/qstash', () => ({
  // Vitest requires a constructible function here (arrow functions can't be
  // `new`-ed, which the real code does: `new Receiver({...})`).
  Receiver: vi.fn().mockImplementation(function Receiver() { this.verify = mockVerify; }),
}));
vi.mock('../../../api/_tiktok.js', () => ({
  getCookie: mockGetCookie,
  getAutomationAccessToken: mockGetAutomationAccessToken,
  recordTikTokPostSync: mockRecordTikTokPostSync,
  scheduleTikTokQStashDelivery: mockScheduleQstash,
}));
vi.mock('../../../api/_firebaseAdmin.js', () => ({
  default: {
    auth: () => ({ verifyIdToken: mockVerifyIdToken }),
    firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } },
  },
  initFirebaseAdmin: mockInitFirebaseAdmin,
}));
vi.mock('../../../api/_audit.js', () => ({ logAudit: mockLogAudit }));
vi.mock('../../../api/_telegramClaim.js', () => ({
  claimPendingPost: mockClaimPendingPost,
  findRecentDuplicateTikTokPost: mockFindRecentDuplicate,
}));
vi.mock('../../../api/_alert.js', () => ({ notifyAdmins: mockNotifyAdmins }));

const handler = (await import('../../../api/tiktok/publish.js')).default;

const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  mockGetCookie.mockReturnValue('cookie-token');
  mockVerifyIdToken.mockRejectedValue(new Error('no bearer token in these tests'));
  mockInitFirebaseAdmin.mockReturnValue({});
});

afterEach(() => {
  // resetAllMocks would also wipe Receiver's constructor mockImplementation
  // (set once above, outside any test) instead of just clearing call history,
  // breaking every later test's "new Receiver()" with a silent throw -> 401
  // no matter what mockVerify is configured to return.
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('POST /api/tiktok/publish', () => {
  it('downloads an https:// video and uploads it via FILE_UPLOAD instead of PULL_FROM_URL', async () => {
    // TikTok's PULL_FROM_URL requires the video_url's domain to be pre-verified
    // in the Developer Portal (DNS TXT record) -- something impossible for our
    // shared ik.imagekit.io hosting domain. Scheduled/cron videos are always an
    // https:// URL, so this path must download the bytes itself and push them
    // to TikTok directly instead.
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (url, options) => {
      const target = String(url);
      if (target === 'https://cdn.example.com/video.mp4') {
        return {
          ok: true,
          headers: { get: (name) => (name === 'content-type' ? 'video/mp4' : null) },
          arrayBuffer: async () => videoBytes.buffer,
        };
      }
      if (target.includes('publish/inbox/video/init')) {
        expect(JSON.parse(options.body)).toEqual({
          source_info: { source: 'FILE_UPLOAD', video_size: 4, chunk_size: 4, total_chunk_count: 1 },
        });
        return { ok: true, json: async () => ({ data: { publish_id: 'pub-1', upload_url: 'https://upload.example.com/put' } }) };
      }
      if (target === 'https://upload.example.com/put') {
        expect(options.method).toBe('PUT');
        expect(Buffer.from(options.body).equals(Buffer.from(videoBytes))).toBe(true);
        return { ok: true };
      }
      throw new Error(`Unexpected fetch to ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      query: {},
      headers: {},
      body: { videoUrl: 'https://cdn.example.com/video.mp4', title: 'A video' },
    };
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, publishId: 'pub-1', mode: 'inbox' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('PULL_FROM_URL'))).toBe(false);
  });

  it('reports a clear error when the video download fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    const req = {
      method: 'POST',
      query: {},
      headers: {},
      body: { videoUrl: 'https://cdn.example.com/missing.mp4', title: 'A video' },
    };
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error.code).toBe('video_download_failed');
  });

  it('still uploads a data: URL video via FILE_UPLOAD (manual publish path)', async () => {
    const base64 = Buffer.from([9, 9, 9]).toString('base64');
    const fetchMock = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.includes('publish/inbox/video/init')) {
        expect(JSON.parse(options.body).source_info).toMatchObject({ source: 'FILE_UPLOAD', video_size: 3 });
        return { ok: true, json: async () => ({ data: { publish_id: 'pub-2', upload_url: 'https://upload.example.com/put' } }) };
      }
      if (target === 'https://upload.example.com/put') {
        return { ok: true };
      }
      throw new Error(`Unexpected fetch to ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      query: {},
      headers: {},
      body: { videoUrl: `data:video/mp4;base64,${base64}`, title: 'A video' },
    };
    const res = response();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, publishId: 'pub-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/tiktok/publish?action=scheduleQstash', () => {
  const req = (body, authorization = 'Bearer good-token') => ({
    method: 'POST',
    query: { action: 'scheduleQstash' },
    headers: authorization ? { authorization } : {},
    body,
  });

  it('rejects a request with no Authorization header', async () => {
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }, ''), res);
    expect(res.statusCode).toBe(401);
    expect(mockScheduleQstash).not.toHaveBeenCalled();
  });

  it('rejects an invalid Firebase ID token', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid token'));
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }), res);
    expect(res.statusCode).toBe(401);
    expect(mockScheduleQstash).not.toHaveBeenCalled();
  });

  it('requires a postId and a valid scheduledTime', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    const res = response();
    await handler(req({ postId: '', scheduledTime: 'not-a-date' }), res);
    expect(res.statusCode).toBe(400);
    expect(mockScheduleQstash).not.toHaveBeenCalled();
  });

  it("rejects scheduling a post that is not the caller's own", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'someone-else' }) }) }) }),
    });
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }), res);
    expect(res.statusCode).toBe(404);
    expect(mockScheduleQstash).not.toHaveBeenCalled();
  });

  it("enqueues QStash delivery for the caller's own pending post", async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'user-1' }) }) }) }),
    });
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockScheduleQstash).toHaveBeenCalledWith(expect.anything(), 'post-1', new Date('2026-09-24T00:00:00.000Z'));
  });

  it('still confirms success to the client even if QStash enqueueing itself throws', async () => {
    // The post is already safely scheduled via the plain Firestore write the
    // client made just before calling this -- a QStash hiccup here must never
    // surface as a scheduling failure; the periodic poller still covers it.
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'user-1' }) }) }) }),
    });
    mockScheduleQstash.mockRejectedValue(new Error('QStash is down'));
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('POST /api/tiktok/publish?action=deliver (QStash callback)', () => {
  const req = (body, headerOverrides = {}) => ({
    method: 'POST',
    query: { action: 'deliver' },
    headers: { 'upstash-signature': 'sig', ...headerOverrides },
    rawBody: JSON.stringify(body),
    body,
  });

  beforeEach(() => {
    process.env.QSTASH_CURRENT_SIGNING_KEY = 'current';
    process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ update: async () => {} }) }),
    });
  });

  afterEach(() => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
  });

  it('rejects a request with no QStash signature', async () => {
    const res = response();
    await handler(req({ postId: 'post-1' }, { 'upstash-signature': undefined }), res);
    expect(res.statusCode).toBe(401);
    expect(mockClaimPendingPost).not.toHaveBeenCalled();
  });

  it('rejects an invalid QStash signature', async () => {
    mockVerify.mockResolvedValue(false);
    const res = response();
    await handler(req({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(401);
    expect(mockClaimPendingPost).not.toHaveBeenCalled();
  });

  it('requires a postId', async () => {
    mockVerify.mockResolvedValue(true);
    const res = response();
    await handler(req({}), res);
    expect(res.statusCode).toBe(400);
  });

  it('skips without publishing when TikTok automation was never connected', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue(null);
    const res = response();
    await handler(req({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, skipped: 'not_connected' });
    expect(mockClaimPendingPost).not.toHaveBeenCalled();
  });

  it('delivers the due post via FILE_UPLOAD and marks it PUBLISHED', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue('token-1');
    mockClaimPendingPost.mockResolvedValue({ post: { videoUrl: 'https://cdn.example.com/video.mp4', content: 'A video', userId: 'user-1' } });
    mockFindRecentDuplicate.mockResolvedValue(null);
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url);
      if (target === 'https://cdn.example.com/video.mp4') {
        return { ok: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => videoBytes.buffer };
      }
      if (target.includes('publish/inbox/video/init')) {
        return { ok: true, json: async () => ({ data: { publish_id: 'pub-1', upload_url: 'https://upload.example.com/put' } }) };
      }
      if (target === 'https://upload.example.com/put') {
        return { ok: true };
      }
      throw new Error(`Unexpected fetch to ${target}`);
    }));
    const res = response();
    await handler(req({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, publishId: 'pub-1' });
  });

  it('notifies admins and reports the failure when the TikTok API call fails', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue('token-1');
    mockClaimPendingPost.mockResolvedValue({ post: { videoUrl: 'https://cdn.example.com/video.mp4', content: 'A video', userId: 'user-1' } });
    mockFindRecentDuplicate.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const res = response();
    await handler(req({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(mockNotifyAdmins).toHaveBeenCalledWith(expect.stringContaining('post-1'));
  });
});
