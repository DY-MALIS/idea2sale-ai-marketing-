import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const {
  mockGetCookie, mockRecordTikTokPostSync, mockVerifyIdToken, mockLogAudit, mockScheduleQstash,
  mockInitFirebaseAdmin, mockGetAutomationAccessToken, mockClaimPendingPost, mockFindRecentDuplicate,
  mockNotifyAdmins, mockVerify,
  mockScheduleYouTube, mockGetYouTubeToken, mockPublishYouTube,
  mockScheduleFacebook, mockGetFacebookPages, mockPublishFacebook, mockGetFacebookReelStatus,
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
  mockScheduleFacebook: vi.fn(),
  mockGetFacebookPages: vi.fn(),
  mockPublishFacebook: vi.fn(),
  mockGetFacebookReelStatus: vi.fn(),
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
vi.mock('../../../api/_facebook.js', () => ({
  scheduleFacebookQStashDelivery: mockScheduleFacebook,
  getFacebookPages: mockGetFacebookPages,
  publishFacebookReel: mockPublishFacebook,
  getFacebookReelStatus: mockGetFacebookReelStatus,
}));

const { default: handler, config, publishVideoToTikTok, deliverOneScheduledTikTokPost, applyTikTokPublishEvent } = await import('../../../api/tiktok/publish.js');

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

it('does not claim an upload succeeded when TikTok omits the upload URL', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { publish_id: 'incomplete-1' }, error: { code: 'ok' } }) }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(publishVideoToTikTok('token', {
    videoUrl: 'data:video/mp4;base64,AQID', title: 'Test video', mode: 'inbox',
  })).rejects.toMatchObject({ code: 'invalid_upload_response' });
  expect(fetchMock).toHaveBeenCalledOnce();
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

it('checks the real TikTok status for the connected owner', async () => {
  const fetchMock = vi.fn(async (url, options) => {
    expect(String(url)).toContain('/publish/status/fetch/');
    expect(JSON.parse(options.body)).toEqual({ publish_id: 'v_pub_file~123' });
    return { ok: true, json: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  const res = response();
  await handler({ method: 'GET', query: { action: 'status', publishId: 'v_pub_file~123' }, headers: { authorization: 'Bearer id-token' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ publishId: 'v_pub_file~123', status: 'PUBLISH_COMPLETE', failReason: null });
});

it('does not disclose TikTok status without the connected owner or a valid publish ID', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  mockVerifyIdToken.mockResolvedValueOnce({ uid: 'another-owner' });
  const unauthorized = response();
  await handler({ method: 'GET', query: { action: 'status', publishId: 'v_pub_file~123' }, headers: { authorization: 'Bearer id-token' } }, unauthorized);
  expect(unauthorized.statusCode).toBe(401);
  const invalid = response();
  await handler({ method: 'GET', query: { action: 'status', publishId: 'bad id' }, headers: { authorization: 'Bearer id-token' } }, invalid);
  expect(invalid.statusCode).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
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
    if (target === 'https://upload.example.com/put') {
      expect(options.headers.Authorization).toBeUndefined();
      expect(options.headers['Content-Range']).toBe('bytes 0-2/3');
      return { ok: true };
    }
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

it('accepts a correctly signed TikTok posting webhook and updates the post', async () => {
  vi.stubEnv('TIKTOK_CLIENT_SECRET', 'test-secret');
  const update = vi.fn();
  mockInitFirebaseAdmin.mockReturnValue({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true }), update }),
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ event: 'post.publish.complete', content: JSON.stringify({ publish_id: 'direct-1' }) });
  const signature = crypto.createHmac('sha256', 'test-secret').update(`${timestamp}.${rawBody}`).digest('hex');
  const res = response();
  await handler({ method: 'POST', query: { action: 'webhook' }, headers: { 'tiktok-signature': `t=${timestamp},s=${signature}` }, rawBody }, res);
  expect(res.statusCode).toBe(200);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISH_COMPLETE' }));
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

  it('parses the unsigned scheduling request when Vercel body parsing is disabled', async () => {
    expect(config.api.bodyParser).toBe(false);
    mockScheduleYouTube.mockResolvedValue(true);
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({
        userId: 'owner-1', platform: 'YOUTUBE', status: 'PENDING', scheduledTime: '2026-09-24T00:00:00.000Z',
      }) }) }) }),
    });
    const request = Object.assign(Readable.from(['{ "postId" : "post-1" }']), {
      method: 'POST', query: { action: 'scheduleQstash' }, headers: { authorization: 'Bearer good-token' },
    });
    const res = response();
    await handler(request, res);
    expect(res.body).toEqual({ ok: true, preciseDeliveryQueued: true });
    expect(mockScheduleYouTube).toHaveBeenCalledOnce();
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
    expect(mockInitFirebaseAdmin.mock.invocationCallOrder[0]).toBeLessThan(mockVerifyIdToken.mock.invocationCallOrder[0]);
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

  it('queues a Facebook Page post using its stored time', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockScheduleFacebook.mockResolvedValue(true);
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ userId: 'user-1', platform: 'FACEBOOK', status: 'PENDING', scheduledTime: '2026-09-24T00:00:00.000Z' }) }) }) }),
    });
    const res = response();
    await handler(req({ postId: 'post-1', scheduledTime: '2099-01-01T00:00:00.000Z' }), res);
    expect(res.body).toEqual({ ok: true, preciseDeliveryQueued: true });
    expect(mockScheduleFacebook).toHaveBeenCalledWith('post-1', new Date('2026-09-24T00:00:00.000Z'));
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

describe('POST /api/tiktok/publish?action=deliverDue', () => {
  const makeRequest = (postId = 'post-1', authorization = 'Bearer id-token') => ({
    method: 'POST', query: { action: 'deliverDue' },
    headers: authorization ? { authorization } : {}, body: { postId },
  });
  const setStoredPost = (post) => {
    const ref = { get: async () => ({ exists: true, data: () => post }), update: vi.fn() };
    mockInitFirebaseAdmin.mockReturnValue({ collection: () => ({ doc: () => ref }) });
    return ref;
  };

  it('requires the signed-in owner of the scheduled post', async () => {
    setStoredPost({ userId: 'owner-1', platform: 'TIKTOK', status: 'PENDING' });
    const unauthenticated = response();
    await handler(makeRequest('post-1', ''), unauthenticated);
    expect(unauthenticated.statusCode).toBe(401);
    mockVerifyIdToken.mockResolvedValue({ uid: 'another-user' });
    const otherOwner = response();
    await handler(makeRequest(), otherOwner);
    expect(otherOwner.statusCode).toBe(404);
    expect(mockClaimPendingPost).not.toHaveBeenCalled();
  });

  it('does not deliver an undued or media-less post', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1' });
    setStoredPost({ userId: 'owner-1', platform: 'TIKTOK', status: 'PENDING',
      scheduledTime: '2099-01-01T00:00:00.000Z', videoUrl: 'https://cdn.example.com/video.mp4' });
    const future = response();
    await handler(makeRequest(), future);
    expect(future.statusCode).toBe(400);
    setStoredPost({ userId: 'owner-1', platform: 'TIKTOK', status: 'PENDING',
      scheduledTime: '2020-01-01T00:00:00.000Z', videoUrl: '' });
    const noVideo = response();
    await handler(makeRequest(), noVideo);
    expect(noVideo.statusCode).toBe(400);
    expect(mockClaimPendingPost).not.toHaveBeenCalled();
  });

  it('delivers an overdue TikTok video through the existing single-claim path', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1' });
    mockGetAutomationAccessToken.mockResolvedValue('tiktok-token');
    mockFindRecentDuplicate.mockResolvedValue(null);
    const videoUrl = 'data:video/mp4;base64,AQID';
    const post = { userId: 'owner-1', platform: 'TIKTOK', status: 'PENDING',
      scheduledTime: '2020-01-01T00:00:00.000Z', videoUrl, content: 'Test clip', publishMode: 'TIKTOK_UPLOAD_DRAFT' };
    const ref = setStoredPost(post);
    mockClaimPendingPost.mockResolvedValue({ post });
    vi.stubGlobal('fetch', vi.fn(async (url) => String(url).includes('/inbox/video/init/')
      ? { ok: true, json: async () => ({ data: { publish_id: 'inbox-due', upload_url: 'https://upload.example.com/put' } }) }
      : { ok: true }));
    const res = response();
    await handler(makeRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, publishId: 'inbox-due' });
    expect(mockClaimPendingPost).toHaveBeenCalledOnce();
    expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'UPLOADED' }));
  });

  it('publishes an overdue YouTube video through the existing single-claim path', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'owner-1' });
    mockClaimPendingPost.mockResolvedValue({ post: {
      userId: 'owner-1', platform: 'YOUTUBE', status: 'PENDING',
      scheduledTime: '2020-01-01T00:00:00.000Z',
      videoUrl: 'https://cdn.example.com/video.mp4', content: 'Test clip',
    } });
    mockFindRecentDuplicate.mockResolvedValue(null);
    mockGetYouTubeToken.mockResolvedValue('youtube-token');
    mockPublishYouTube.mockResolvedValue({ videoId: 'youtube-due' });
    const ref = setStoredPost({ userId: 'owner-1', platform: 'YOUTUBE', status: 'PENDING',
      scheduledTime: '2020-01-01T00:00:00.000Z', videoUrl: 'https://cdn.example.com/video.mp4' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true,
      headers: { get: (name) => name === 'content-type' ? 'video/mp4' : null },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })));
    const res = response();
    await handler(makeRequest(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, videoId: 'youtube-due' });
    expect(ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISHED', youtubeVideoId: 'youtube-due' }));
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

  it('verifies the exact signed callback body, including its whitespace', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetAutomationAccessToken.mockResolvedValue(null);
    mockClaimPendingPost.mockResolvedValue({ post: { userId: 'user-1' } });
    const rawBody = '{ "postId" : "post-1" }';
    const request = Object.assign(Readable.from([rawBody]), {
      method: 'POST', query: { action: 'deliver' }, headers: { 'upstash-signature': 'sig' }, complete: true,
    });
    const res = response();
    await handler(request, res);
    expect(mockVerify).toHaveBeenCalledWith({ signature: 'sig', body: rawBody });
    expect(res.statusCode).toBe(200);
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

  it('queues another Facebook Reel status check while processing, then marks it published', async () => {
    mockVerify.mockResolvedValue(true);
    mockGetFacebookPages.mockResolvedValue({ pages: [{ id: 'page-1', accessToken: 'page-token' }] });
    mockGetFacebookReelStatus
      .mockResolvedValueOnce({ status: { video_status: 'processing' } })
      .mockResolvedValueOnce({ status: { video_status: 'published' } });
    mockScheduleFacebook.mockResolvedValue(true);
    const post = {
      platform: 'FACEBOOK', status: 'SUBMITTED', userId: 'user-one',
      facebookPageId: 'page-1', facebookVideoId: 'video-1',
      submittedAt: { toMillis: () => Date.now() - 60_000 },
    };
    const update = vi.fn(async (fields) => Object.assign(post, fields));
    mockInitFirebaseAdmin.mockReturnValue({
      collection: () => ({ doc: () => ({ id: 'post-1', update, get: async () => ({ exists: true, data: () => post }) }) }),
    });
    const request = { ...req({ postId: 'post-1' }), query: { action: 'facebookDeliver' } };
    const first = response();
    await handler(request, first);
    expect(first.body).toEqual({ ok: true, status: 'processing' });
    expect(mockScheduleFacebook).toHaveBeenCalledWith('post-1', expect.any(Date));
    const second = response();
    await handler(request, second);
    expect(second.body).toEqual({ ok: true, status: 'published' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'PUBLISHED' }));
    expect(mockScheduleFacebook).toHaveBeenCalledTimes(1);
  });
});
