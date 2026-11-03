import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { ensureVideoImageDataUrl, prepareVideoProductImageUrl } from '../../api/_videoReferenceImage.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('enlarges an 88 by 91 pixel starting image before video generation', async () => {
  const tiny = await sharp({ create: { width: 88, height: 91, channels: 3, background: 'red' } }).png().toBuffer();
  const dataUrl = await ensureVideoImageDataUrl(`data:image/png;base64,${tiny.toString('base64')}`);
  const enlarged = Buffer.from(dataUrl.split(',')[1], 'base64');
  const dimensions = await sharp(enlarged).metadata();
  expect(dimensions.width).toBeGreaterThanOrEqual(512);
  expect(dimensions.height).toBeGreaterThanOrEqual(512);
});

it('pads an unusually narrow image while preserving its full content', async () => {
  const narrow = await sharp({ create: { width: 40, height: 600, channels: 3, background: 'red' } }).png().toBuffer();
  const dataUrl = await ensureVideoImageDataUrl(`data:image/png;base64,${narrow.toString('base64')}`);
  const dimensions = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
  expect(dimensions.width).toBe(1024);
  expect(dimensions.height).toBe(1024);
});

it('replaces a tiny saved product thumbnail with an enlarged stored image', async () => {
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'test');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'test');
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/test');
  const tiny = await sharp({ create: { width: 88, height: 91, channels: 3, background: 'blue' } }).png().toBuffer();
  const fetchMock = vi.fn(async () => new Response(new Uint8Array(tiny)));
  vi.stubGlobal('fetch', fetchMock);
  const upload = vi.fn(async ({ mediaDataUrl }) => {
    const dimensions = await sharp(Buffer.from(mediaDataUrl.split(',')[1], 'base64')).metadata();
    expect(dimensions.width).toBeGreaterThanOrEqual(512);
    expect(dimensions.height).toBeGreaterThanOrEqual(512);
    return { mediaUrl: 'https://ik.imagekit.io/test/enlarged.png?tr=w-1280' };
  });
  const url = await prepareVideoProductImageUrl('https://ik.imagekit.io/test/product.png?tr=w-88', upload);
  expect(fetchMock.mock.calls[0][0]).toBe('https://ik.imagekit.io/test/product.png');
  expect(upload).toHaveBeenCalledOnce();
  expect(url).toBe('https://ik.imagekit.io/test/enlarged.png');
});

it('keeps a large saved image at its original URL without another upload', async () => {
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'test');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'test');
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/test');
  const fullSize = await sharp({ create: { width: 640, height: 640, channels: 3, background: 'green' } }).png().toBuffer();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(fullSize))));
  const upload = vi.fn();
  const url = await prepareVideoProductImageUrl('https://ik.imagekit.io/test/product.png?tr=w-88', upload);
  expect(url).toBe('https://ik.imagekit.io/test/product.png');
  expect(upload).not.toHaveBeenCalled();
});
