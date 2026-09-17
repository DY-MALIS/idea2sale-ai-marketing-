import { describe, expect, it } from 'vitest';
import { formatCloudinaryUploadError } from '../../shared/cloudinaryError.js';

describe('formatCloudinaryUploadError', () => {
  it('does not expose an API key echoed by Cloudinary', () => {
    const fakeKey = 'exampleCloudinaryKey123';
    const result = formatCloudinaryUploadError(`Invalid api_key ${fakeKey}`, fakeKey);

    expect(result).toBe('Cloudinary media storage credentials are invalid. Update the Cloudinary settings in Vercel and redeploy.');
    expect(result).not.toContain(fakeKey);
  });

  it('redacts an echoed API key even when the configured key is unavailable', () => {
    expect(formatCloudinaryUploadError('Unknown API key fakeKey12345')).not.toContain('fakeKey12345');
  });

  it('keeps a useful non-credential upload error', () => {
    expect(formatCloudinaryUploadError('File size too large.')).toBe('File size too large.');
  });

  it('uses a safe fallback for an empty provider response', () => {
    expect(formatCloudinaryUploadError('')).toBe('Cloudinary upload failed.');
  });
});
