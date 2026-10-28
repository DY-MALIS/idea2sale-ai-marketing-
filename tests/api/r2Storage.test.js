import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = mocks.send; },
  PutObjectCommand: class { constructor(input) { this.input = input; } },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.sign }));
const { createR2UploadAuth, isR2MediaUrl, uploadR2DataUrl, uploadR2RemoteUrl } = await import('../../api/_r2Storage.js');

const original = Object.fromEntries(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'].map((key) => [key, process.env[key]]));
beforeEach(() => {
  process.env.R2_ACCOUNT_ID = 'a'.repeat(32);
  process.env.R2_ACCESS_KEY_ID = 'access';
  process.env.R2_SECRET_ACCESS_KEY = 'secret';
  process.env.R2_BUCKET = 'media';
  process.env.R2_PUBLIC_URL = 'https://media.example.com';
  mocks.send.mockReset().mockResolvedValue({});
  mocks.sign.mockReset().mockResolvedValue('https://signed.example.com/put');
});
afterEach(() => { for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value; });

describe('R2 media storage', () => {
  it('signs an owner-scoped browser upload without exposing the secret', async () => {
    const auth = await createR2UploadAuth({ folder: '/telegram-media/owner', fileName: 'clip.mp4', contentType: 'video/mp4' });
    expect(auth).toMatchObject({ provider: 'r2', method: 'PUT', uploadUrl: 'https://signed.example.com/put', contentType: 'video/mp4' });
    expect(auth.key).toMatch(/^telegram-media\/owner\/[a-f0-9-]+-clip\.mp4$/);
    expect(auth.url).toContain(auth.key);
    expect(JSON.stringify(auth)).not.toContain('secret');
  });

  it('uploads bytes and trusts only the configured public host', async () => {
    const uploaded = await uploadR2DataUrl({ mediaDataUrl: 'data:video/mp4;base64,YWJj', mediaType: 'video' });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send.mock.calls[0][0].input).toMatchObject({ Bucket: 'media', Body: Buffer.from('abc'), ContentType: 'video/mp4' });
    expect(isR2MediaUrl(uploaded.mediaUrl)).toBe(true);
    expect(isR2MediaUrl('https://media.example.com.evil.test/clip.mp4')).toBe(false);
    expect(isR2MediaUrl('https://media.example.com/clip.mp4?redirect=1')).toBe(false);
  });

  it('does not fetch an unsigned provider URL from the server', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(uploadR2RemoteUrl({ mediaUrl: 'https://provider.example/video.mp4' })).rejects.toThrow('authenticated provider download');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
