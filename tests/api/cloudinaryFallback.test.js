import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createCloudinaryUploadAuth, isCloudinaryMediaUrl, isImageKitQuotaError } from '../../api/_cloudinaryStorage.js';
import { uploadMediaDataUrl } from '../../api/_imagekitUpload.js';

const originalFetch = global.fetch;
afterEach(() => { vi.unstubAllEnvs(); global.fetch = originalFetch; vi.restoreAllMocks(); });

const configure = () => {
  vi.stubEnv('IMAGEKIT_PUBLIC_KEY', 'public_test');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', 'private_test');
  vi.stubEnv('IMAGEKIT_URL_ENDPOINT', 'https://ik.imagekit.io/example');
  vi.stubEnv('CLOUDINARY_FALLBACK_ENABLED', 'true');
  vi.stubEnv('CLOUDINARY_CLOUD_NAME', 'my-cloud');
  vi.stubEnv('CLOUDINARY_API_KEY', '12345');
  vi.stubEnv('CLOUDINARY_API_SECRET', 'secret-test');
};

describe('Cloudinary quota fallback', () => {
  it('signs a folder-scoped browser upload without exposing the secret', () => {
    configure();
    const auth = createCloudinaryUploadAuth({ folder: '/telegram-media/company-1' });
    expect(auth).toMatchObject({ provider: 'cloudinary', cloudinaryFolder: 'aime/telegram-media/company-1', apiKey: '12345' });
    expect(auth.signature).toBe(createHash('sha256').update(`folder=${auth.cloudinaryFolder}&timestamp=${auth.timestamp}secret-test`).digest('hex'));
    expect(JSON.stringify(auth)).not.toContain('secret-test');
  });

  it('accepts only URLs inside the configured Cloudinary environment', () => {
    configure();
    expect(isCloudinaryMediaUrl('https://res.cloudinary.com/my-cloud/video/upload/v1/clip.mp4')).toBe(true);
    expect(isCloudinaryMediaUrl('https://res.cloudinary.com/other-cloud/video/upload/v1/clip.mp4')).toBe(false);
    expect(isCloudinaryMediaUrl('http://res.cloudinary.com/my-cloud/video/upload/v1/clip.mp4')).toBe(false);
  });

  it('recognizes quota responses without classifying ordinary errors as quota', () => {
    expect(isImageKitQuotaError(403, 'Storage limit exceeded')).toBe(true);
    expect(isImageKitQuotaError(403, 'Video processing units limit exceeded')).toBe(true);
    expect(isImageKitQuotaError(429, 'Rate limited, try again')).toBe(false);
    expect(isImageKitQuotaError(401, 'Invalid private key')).toBe(false);
  });

  it('retries a quota-rejected upload on Cloudinary and retains the new URL', async () => {
    configure();
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ message: 'Storage limit exceeded' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ secure_url: 'https://res.cloudinary.com/my-cloud/video/upload/v1/clip.mp4', resource_type: 'video', asset_id: 'asset-1', public_id: 'aime/generation-history/clip' }) });
    const result = await uploadMediaDataUrl({ mediaDataUrl: 'data:video/mp4;base64,AAAA', mediaType: 'video' });
    expect(result.mediaUrl).toBe('https://res.cloudinary.com/my-cloud/video/upload/v1/clip.mp4');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][1].body.get('api_secret')).toBeNull();
  });

  it('does not send invalid credentials to Cloudinary', async () => {
    configure();
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'Invalid private key' }) });
    await expect(uploadMediaDataUrl({ mediaDataUrl: 'data:video/mp4;base64,AAAA', mediaType: 'video' })).rejects.toThrow(/credentials are invalid/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
