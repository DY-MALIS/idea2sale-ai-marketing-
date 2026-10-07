import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetCookie, mockRecordTikTokPostSync, mockVerifyIdToken, mockLogAudit, mockScheduleQstash,
  mockInitFirebaseAdmin, mockGetAutomationAccessToken, mockClaimPendingPost, mockFindRecentDuplicate,
  mockNotifyAdmins, mockVerify,
  mockScheduleYouTube, mockGetYouTubeToken, mockPublishYouTube,
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
  mockScheduleYouTube: vi.fn(),
  mockGetYouTubeToken: vi.fn(),
  mockPublishYouTube: vi.fn(),
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
  findRecentDuplicateYouTubePost: mockFindRecentDuplicate,
}));
vi.mock('../../../api/_alert.js', () => ({ notifyAdmins: mockNotifyAdmins }));
vi.mock('../../../api/_youtube.js', () => ({
  scheduleYouTubeQStashDelivery: mockScheduleYouTube,
  getYouTubeAutomationAccessToken: mockGetYouTubeToken,
  publishVideoToYouTube: mockPublishYouTube,
}));

const { default: handler, publishVideoToTikTok, deliverOneScheduledTikTokPost, applyTikTokPublishEvent } = await import('../../../api/tiktok/publish.js');

const response = () => ({
  statusCode: 200,
  headers: {},
  setHeader(name, value) { this.headers[name] = value; },
  status(n) { this.statusCode = n; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  mockGetCookie.mockImplementation((_req, name) => name === 'tiktok_owner' ? 'owner-1' : 'cookie-token');
  mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1' });
  mockInitFirebaseAdmin.mockReturnValue({});
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://cdn.example.com');
});

afterEach(() => {
  // resetAllMocks would also wipe Receiver's constructor mockImplementation
  // (set once above, outside any test) instead of just clearing call history,
  // breaking every later test's "new Receiver()" with a silent throw -> 401
  // no matter what mockVerify is configured to return.
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('sends an explicitly selected inbox upload even when the server default is direct', async () => {
  vi.stubEnv('TIKTOK_POST_MODE', 'direct');
  const fetchMock = vi.fn(async (url) => {
    if (String(url).includes('/inbox/video/init/')) {
      return { ok: true, json: async () => ({ data: { publish_id: 'inbox-1', upload_url: 'https://upload.example.com/put' } }) };
    }
    if (String(url) === 'https://upload.example.com/put') return { ok: true };
    throw new Error(`Unexpected fetch to ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const result = await publishVideoToTikTok('token', {
    videoUrl: `data:video/mp4;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    title: 'Test video', mode: 'inbox',
  });
  expect(result).toMatchObject({ publishId: 'inbox-1', directPost: false });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('loads current TikTok creator settings for the signed-in owner', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    expect(String(url)).toContain('/creator_info/query/');
    return { ok: true, json: async () => ({ data: { creator_nickname: 'Owner', privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } }) };
  }));
  const res = response();
  await handler({ method: 'GET', query: { action: 'creatorInfo' }, headers: { authorization: 'Bearer id-token' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.creator.creator_nickname).toBe('Owner');
});

it('rejects a direct post before upload when privacy or consent was not selected', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { privacy_level_options: ['SELF_ONLY'], max_video_post_duration_sec: 60 }, error: { code: 'ok' } }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(publishVideoToTikTok('token', {
    videoUrl: 'data:video/mp4;base64,AQID', title: 'Caption', mode: 'direct',
    directPostOptions: { privacyLevel: 'PUBLIC_TO_EVERYONE', durationSeconds: 8, consent: true },
  })).rejects.toMatchObject({ code: 'privacy_level_option_mismatch' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(publishVideoToTikTok('token', {
    videoUrl: 'data:video/mp4;base64,AQID', title: 'Caption', mode: 'direct',
    directPostOptions: { privacyLevel: 'SELF_ONLY', durationSeconds: 8, consent: false },
  })).rejects.toMatchObject({ code: 'invalid_direct_post_settings' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('uses the creator-selected direct post settings without defaulting interactions or branding on', async () => {
  const fetchMock = vi.fn(async (url, options) => {
    const target = String(url);
    if (target.includes('/creator_info/query/')) return {
      ok: true,
      json: async () => ({ data: {
        privacy_level_options: ['SELF_ONLY', 'PUBLIC_TO_EVERYONE'],
        comment_disabled: false, duet_disabled: true, stitch_disabled: false,
        max_video_post_duration_sec: 30,
      }, error: { code: 'ok' } }),
    };
    if (target.includes('/publish/video/init/')) {
      expect(JSON.parse(options.body).post_info).toMatchObject({
        privacy_level: 'PUBLIC_TO_EVERYONE', disable_comment: true, disable_duet: true,
        disable_stitch: false, brand_content_toggle: false, brand_organic_toggle: true,
      });
      return { ok: true, json: async () => ({ data: { publish_id: 'direct-1', upload_url: 'https://upload.example.com/put' }, error: { code: 'ok' } }) };
    }
    if (target === 'https://upload.example.com/put') return { ok: true };
    throw new Error(`Unexpected fetch to ${target}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await publishVideoToTikTok('token', {
    videoUrl: 'data:video/mp4;base64,AQID', title: 'Caption', mode: 'direct',
    directPostOptions: {
      privacyLevel: 'PUBLIC_TO_EVERYONE', durationSeconds: 8, consent: true,
      allowComment: false, allowDuet: true, allowStitch: true,
      commercialDisclosure: true, ownBrand: true, brandedContent: false,
    },
  });
  expect(result).toMatchObject({ publishId: 'direct-1', directPost: true });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('waits for TikTok confirmation before marking a submitted Direct Post published', async () => {
  const postUpdate = vi.fn();
  const scheduledUpdate = vi.fn();
  const db = { collection: vi.fn((name) => name === 'tiktok_posts'
    ? { doc: () => ({ get: async () => ({ exists: true }), update: postUpdate }) }
    : { where: () => ({ limit: () => ({ get: async () => ({ docs: [{ ref: { update: scheduledUpdate } }] }) }) }) }) };
  expect(await applyTikTokPublishEvent(db, 'post.publish.complete', { publish_id: 'direct-1' })).toBe(true);
  expect(postUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISH_COMPLETE' }));
  expect(scheduledUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISHED' }));
});

it('records an inbox transfer as awaiting the creator instead of already published', async () => {
  mockClaimPendingPost.mockResolvedValue({ post: {
    videoUrl: `data:video/mp4;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    content: 'Test video', userId: 'owner', publishMode: 'TIKTOK_UPLOAD_DRAFT',
  } });
  mockFindRecentDuplicate.mockResolvedValue(null);
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).includes('/inbox/video/init/')
    ? { ok: true, json: async () => ({ data: { publish_id: 'inbox-2', upload_url: 'https://upload.example.com/put' } }) }
    : { ok: true }));
  const update = vi.fn();
  const result = await deliverOneScheduledTikTokPost({}, { update }, 'token');
  expect(result).toMatchObject({ ok: true, publishId: 'inbox-2' });
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'UPLOADED', tiktokDeliveryMode: 'inbox' }));
});

describe('POST /api/tiktok/publish', () => {
  it('rejects a TikTok cookie owned by another signed-in profile', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'other-owner' });
    const res = response();
    await handler({ method: 'POST', query: {}, headers: { authorization: 'Bearer id-token' }, body: { videoUrl: 'data:video/mp4;base64,AA==' } }, res);
    expect(res.statusCode).toBe(401);
  });
  it('downloads the original ImageKit MP4 when video transformations are exhausted', async () => {
    const source = 'https://ik.imagekit.io/demo/video.mp4';
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.startsWith(source)) {
        expect(new URL(target).searchParams.get('tr')).toBe('orig-true');
        return { ok: true, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      }
      if (target.includes('/inbox/video/init/')) {
        return { ok: true, json: async () => ({ data: { publish_id: 'pub-original', upload_url: 'https://upload.example.com/put' } }) };
      }
      if (target === 'https://upload.example.com/put') return { ok: true };
      throw new Error(`Unexpected fetch to ${target}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishVideoToTikTok('token', { videoUrl: source, title: 'A video', mode: 'inbox' });
    expect(result).toMatchObject({ publishId: 'pub-original', directPost: false });
  });

  it('downloads an https:// video and uploads it via FILE_UPLOAD instead of PULL_FROM_URL', async () => {
    // TikTok's PULL_FROM_URL requires the video_url's domain to be pre-verified
    // in the Developer Portal (DNS TXT record) -- something impossible for our
    // shared ik.imagekit.io hosting domain. Scheduled/cron videos are always an
    // https:// URL, so this path must download the bytes itself and push them
    // to TikTok directly instead.
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn(async (url, options) => {
      const target = String(url);
      if (target.startsWith('https://cdn.example.com/video.mp4')) {
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
      headers: { authorization: 'Bearer id-token' },
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
      headers: { authorization: 'Bearer id-token' },
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
      headers: { authorization: 'Bearer id-token' },
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
    mockScheduleQstash.mockResolvedValue(true);
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'user-1', platform: 'TIKTOK', status: 'PENDING', scheduledTime: '2026-09-24T00:00:00.000Z' }) }) }) }),
    });
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, preciseDeliveryQueued: true });
    expect(mockScheduleQstash).toHaveBeenCalledWith(expect.anything(), 'post-1', new Date('2026-09-24T00:00:00.000Z'));
  });

  it('queues a YouTube post using its stored time and channel owner', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockScheduleYouTube.mockResolvedValue(true);
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'user-1', platform: 'YOUTUBE', status: 'PENDING', scheduledTime: '2026-09-24T00:00:00.000Z' }) }) }) }),
    });
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2099-01-01T00:00:00.000Z' }), res);
    expect(res.body).toEqual({ ok: true, preciseDeliveryQueued: true });
    expect(mockScheduleYouTube).toHaveBeenCalledWith(expect.anything(), 'post-1', new Date('2026-09-24T00:00:00.000Z'));
  });

  it('still confirms success to the client even if QStash enqueueing itself throws', async () => {
    // The post is already safely scheduled via the plain Firestore write the
    // client made just before calling this -- a QStash hiccup here must never
    // surface as a scheduling failure; the periodic poller still covers it.
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'user-1', platform: 'TIKTOK', status: 'PENDING', scheduledTime: '2026-09-24T00:00:00.000Z' }) }) }) }),
    });
    mockScheduleQstash.mockRejectedValue(new Error('QStash is down'));
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2026-09-24T00:00:00.000Z' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, preciseDeliveryQueued: false });
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
      collection: () => ({ doc: () => ({ update: async () => {}, get: async () => ({ exists: true, data: () => ({ userId: 'user-1', platform: 'TIKTOK' }) }) }) }),
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

  it('marks a pending post failed when its owner never connected TikTok', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue(null);
    mockClaimPendingPost.mockResolvedValue({ post: { userId: 'user-1' } });
    const update = vi.fn();
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ update, get: async () => ({ exists: true, data: () => ({ userId: 'user-1', platform: 'TIKTOK' }) }) }) }),
    });
    const res = response();
    await handler(req({ postId: 'post-1' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, skipped: 'not_connected' });
    expect(mockClaimPendingPost).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', tiktokErrorCode: 'not_connected' }));
  });

  it('delivers the due post via FILE_UPLOAD and marks it PUBLISHED', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue('token-1');
    mockClaimPendingPost.mockResolvedValue({ post: { videoUrl: 'https://cdn.example.com/video.mp4', content: 'A video', userId: 'user-1' } });
    mockFindRecentDuplicate.mockResolvedValue(null);
    const videoBytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const target = String(url);
      if (target.startsWith('https://cdn.example.com/video.mp4')) {
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

  it('delivers a signed YouTube job using its owner connection', async () => {
    mockVerify.mockResolvedValue(true);
    mockClaimPendingPost.mockResolvedValue({ post: { videoUrl: 'https://cdn.example.com/video.mp4', content: 'A video', userId: 'user-one' } });
    mockFindRecentDuplicate.mockResolvedValue(null);
    mockGetYouTubeToken.mockResolvedValue('owner-token');
    mockPublishYouTube.mockResolvedValue({ videoId: 'youtube-1' });
    const update = vi.fn();
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ update, get: async () => ({ exists: true, data: () => ({ userId: 'user-one', platform: 'YOUTUBE' }) }) }) }),
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: (name) => name === 'content-type' ? 'video/mp4' : null },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })));
    const res = response();
    await handler({ ...req({ postId: 'post-1' }), query: { action: 'youtubeDeliver' } }, res);
    expect(res.body).toEqual({ ok: true, videoId: 'youtube-1' });
    expect(mockGetYouTubeToken).toHaveBeenCalledWith(expect.anything(), 'user-one');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISHED', youtubeVideoId: 'youtube-1' }));
  });
});
