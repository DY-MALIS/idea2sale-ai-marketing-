import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

import handler from '../../api/mediaProxy.js';

const responseRecorder = () => {
  const response = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  return response;
};

beforeEach(() => {
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'public_test');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'private_test');
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/testaccount');
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('rejects non-GET requests', async () => {
  const req = { method: 'POST', query: {} };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(405);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('rejects a URL outside the configured ImageKit endpoint', async () => {
  const req = { method: 'GET', query: { url: 'https://evil.example.com/steal-this' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('rejects a missing url parameter', async () => {
  const req = { method: 'GET', query: {} };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it('proxies a valid ImageKit video URL, preserving content type', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  mocks.fetch.mockResolvedValue({
    ok: true,
    headers: new Map([['content-type', 'video/mp4'], ['content-length', String(bytes.length)]]),
    arrayBuffer: async () => bytes.buffer,
  });
  const req = { method: 'GET', query: { url: 'https://ik.imagekit.io/testaccount/generation-history/clip.mp4' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.headers['Content-Type']).toBe('video/mp4');
  expect(Buffer.from(res.body)).toEqual(Buffer.from(bytes));
  expect(mocks.fetch).toHaveBeenCalledWith('https://ik.imagekit.io/testaccount/generation-history/clip.mp4', expect.any(Object));
});

it('surfaces a 502 when the upstream ImageKit fetch fails outright', async () => {
  mocks.fetch.mockRejectedValue(new Error('network down'));
  const req = { method: 'GET', query: { url: 'https://ik.imagekit.io/testaccount/generation-history/clip.mp4' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});

it('surfaces a 502 when the upstream responds with a non-OK status', async () => {
  mocks.fetch.mockResolvedValue({ ok: false, status: 404, headers: new Map() });
  const req = { method: 'GET', query: { url: 'https://ik.imagekit.io/testaccount/generation-history/clip.mp4' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});

it('rejects media larger than the proxy limit via the content-length header', async () => {
  mocks.fetch.mockResolvedValue({
    ok: true,
    headers: new Map([['content-type', 'video/mp4'], ['content-length', String(100 * 1024 * 1024)]]),
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  const req = { method: 'GET', query: { url: 'https://ik.imagekit.io/testaccount/generation-history/huge.mp4' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(413);
});
