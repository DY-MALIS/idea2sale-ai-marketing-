import { describe, expect, it } from 'vitest';
import { formatImageKitUploadError } from '../../shared/imageKitError.js';

describe('formatImageKitUploadError', () => {
  it('does not expose configured ImageKit keys', () => {
    const publicKey = 'public_example_key';
    const privateKey = 'private_example_key';
    const result = formatImageKitUploadError(`Invalid credential ${publicKey} ${privateKey}`, [publicKey, privateKey]);

    expect(result).toContain('ImageKit media storage credentials are invalid');
    expect(result).not.toContain(publicKey);
    expect(result).not.toContain(privateKey);
  });

  it('keeps a useful non-credential upload error', () => {
    expect(formatImageKitUploadError('File size too large.')).toBe('File size too large.');
  });

  it('uses a safe fallback for an empty provider response', () => {
    expect(formatImageKitUploadError('')).toBe('ImageKit upload failed.');
  });
});
