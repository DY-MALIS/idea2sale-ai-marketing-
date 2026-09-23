import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCookie, mockRecordTikTokPostSync, mockVerifyIdToken, mockLogAudit } = vi.hoisted(() => ({
  mockGetCookie: vi.fn(),
  mockRecordTikTokPostSync: vi.fn(),
  mockVerifyIdToken: vi.fn(),
  mockLogAudit: vi.fn(),
}));
vi.mock('../../../api/_tiktok.js', () => ({
  getCookie: mockGetCookie,
  getAutomationAccessToken: vi.fn(),
  recordTikTokPostSync: mockRecordTikTokPostSync,
}));
vi.mock('../../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: mockVerifyIdToken }) },
  initFirebaseAdmin: vi.fn(() => ({})),
}));
vi.mock('../../../api/_audit.js', () => ({ logAudit: mockLogAudit }));

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
});

afterEach(() => {
  vi.resetAllMocks();
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
