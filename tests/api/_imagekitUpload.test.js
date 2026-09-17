import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyImageKitAudioExtractionTransform,
  applyImageKitDeliveryTransform,
  createImageKitUploadAuth,
  getImageKitConfig,
  isImageKitMediaUrl,
  uploadMediaDataUrl,
} from '../../api/_imagekitUpload.js';

const originalFetch = global.fetch;

afterEach(() => {
  vi.unstubAllEnvs();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const configureImageKit = () => {
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'public_test_key');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'private_test_key');
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/acme');
};

describe('ImageKit configuration and signed browser uploads', () => {
  it('rejects missing configuration', () => {
    vi.stubEnv('IMAGEKIT_PUBLIC_KEY', '');
    vi.stubEnv('IMAGEKIT_PRIVATE_KEY', '');
    vi.stubEnv('IMAGEKIT_URL_ENDPOINT', '');
    expect(() => getImageKitConfig()).toThrow('ImageKit is not configured');
  });

  it('creates an expiring HMAC upload signature without returning the private key', () => {
    configureImageKit();
    const auth = createImageKitUploadAuth();
    expect(auth).toMatchObject({
      publicKey: 'public_test_key',
      uploadUrl: 'https://upload.imagekit.io/api/v1/files/upload',
      maxBytes: 48 * 1024 * 1024,
    });
    expect(auth.token).toBeTruthy();
    expect(auth.signature).toMatch(/^[a-f0-9]{40}$/);
    expect(auth.expire).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(auth).not.toHaveProperty('privateKey');
  });
});

describe('ImageKit delivery URLs', () => {
  it('accepts only URLs under the configured endpoint', () => {
    configureImageKit();
    expect(isImageKitMediaUrl('https://ik.imagekit.io/acme/telegram-media/file.mp4')).toBe(true);
    expect(isImageKitMediaUrl('https://ik.imagekit.io/another-account/file.mp4')).toBe(false);
    expect(isImageKitMediaUrl('https://example.com/file.mp4')).toBe(false);
  });

  it('combines delivery and audio-extraction transformations', () => {
    const delivered = applyImageKitDeliveryTransform('https://ik.imagekit.io/acme/video.mp4', 'video');
    const extracted = applyImageKitAudioExtractionTransform(delivered);
    expect(new URL(extracted).searchParams.get('tr')).toBe('w-1280,q-70,f-mp4:vc-none,ac-aac,f-mp4');
  });
});

describe('server-side ImageKit upload', () => {
  it('keeps the private key server-side and returns durable upload metadata', async () => {
    configureImageKit();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://ik.imagekit.io/acme/telegram-media/file.mp4',
        fileId: 'file-id',
        filePath: '/telegram-media/file.mp4',
        duration: 3.5,
      }),
    });

    const result = await uploadMediaDataUrl({
      mediaDataUrl: 'data:video/mp4;base64,AAAA',
      mediaType: 'video',
      folder: '/telegram-media',
      fileName: 'clip.mp4',
    });

    expect(result).toMatchObject({
      mediaType: 'video',
      fileId: 'file-id',
      filePath: '/telegram-media/file.mp4',
      duration: 3.5,
    });
    expect(new URL(result.mediaUrl).searchParams.get('tr')).toBe('w-1280,q-70,f-mp4');
    const [, request] = global.fetch.mock.calls[0];
    expect(request.headers.Authorization).toMatch(/^Basic /);
    expect(request.body.get('publicKey')).toBeNull();
    expect(request.body.get('file')).toBe('data:video/mp4;base64,AAAA');
    expect(request.body.get('folder')).toBe('/telegram-media');
  });

  it('returns narration audio without an incompatible image transform', async () => {
    configureImageKit();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://ik.imagekit.io/acme/generation-history/narration.mp3',
        fileId: 'audio-id',
        filePath: '/generation-history/narration.mp3',
        duration: 3.5,
      }),
    });

    const result = await uploadMediaDataUrl({
      mediaDataUrl: 'data:audio/mpeg;base64,AAAA',
      mediaType: 'audio',
    });

    expect(result.mediaUrl).toBe('https://ik.imagekit.io/acme/generation-history/narration.mp3');
    expect(result.duration).toBe(3.5);
  });
});
