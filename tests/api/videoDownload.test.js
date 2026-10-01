import { afterEach, expect, it, vi } from 'vitest';
import { downloadTrustedVideo, isTrustedVideoUrl } from '../../api/_videoDownload.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('rejects untrusted video sources before contacting them', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(isTrustedVideoUrl('https://example.com/video.mp4')).toBe(false);
  await expect(downloadTrustedVideo('https://example.com/video.mp4')).rejects.toMatchObject({ code: 'untrusted_video_url' });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('downloads a small stored video and controls redirects', async () => {
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://cdn.example.com/videos');
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'video/mp4' } }));
  vi.stubGlobal('fetch', fetchMock);
  const video = await downloadTrustedVideo('https://cdn.example.com/videos/clip.mp4');
  expect(video.buffer).toEqual(Buffer.from([1, 2, 3]));
  expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
});

it('blocks a redirect from app storage to an untrusted host', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/private' } })));
  await expect(downloadTrustedVideo('https://ik.imagekit.io/demo/video.mp4'))
    .rejects.toMatchObject({ code: 'untrusted_video_redirect' });
});

it('stops a streaming download when it exceeds the publishing limit', async () => {
  let chunksSent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunksSent++ < 51) controller.enqueue(new Uint8Array(1024 * 1024));
      else controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
    headers: { 'content-type': 'video/mp4' },
  })));
  await expect(downloadTrustedVideo('https://ik.imagekit.io/demo/large.mp4'))
    .rejects.toMatchObject({ code: 'video_too_large' });
});
