import { describe, expect, it } from 'vitest';
import { applyCloudinaryDeliveryTransform, truncateForTelegram } from '../../../api/telegram/run-scheduled.js';

describe('truncateForTelegram', () => {
  it('leaves short text untouched', () => {
    expect(truncateForTelegram('hello', 1024)).toBe('hello');
  });

  it('truncates text over the limit and appends an ellipsis', () => {
    const text = 'a'.repeat(2000);
    const result = truncateForTelegram(text, 1024);
    expect(result.length).toBe(1024);
    expect(result.endsWith('…')).toBe(true);
  });

  it('treats non-string/nullish input as empty', () => {
    expect(truncateForTelegram(undefined, 10)).toBe('');
    expect(truncateForTelegram(null, 10)).toBe('');
  });
});

describe('applyCloudinaryDeliveryTransform', () => {
  const imageUrl = 'https://res.cloudinary.com/demo/image/upload/v1700000000/telegram-media/foo.png';
  const videoUrl = 'https://res.cloudinary.com/demo/video/upload/v1700000000/telegram-media/foo.mp4';

  it('inserts a resize transform for an image URL', () => {
    const result = applyCloudinaryDeliveryTransform(imageUrl, 'photo');
    expect(result).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_1280,q_auto,f_auto/v1700000000/telegram-media/foo.png'
    );
  });

  it('inserts a resize transform for a video URL', () => {
    const result = applyCloudinaryDeliveryTransform(videoUrl, 'video');
    expect(result).toBe(
      'https://res.cloudinary.com/demo/video/upload/q_auto,w_1280/v1700000000/telegram-media/foo.mp4'
    );
  });

  it('is idempotent -- calling it twice does not double up the transform', () => {
    const once = applyCloudinaryDeliveryTransform(imageUrl, 'photo');
    const twice = applyCloudinaryDeliveryTransform(once, 'photo');
    expect(twice).toBe(once);
  });

  it('leaves non-Cloudinary URLs unchanged', () => {
    const url = 'https://example.com/some/image.png';
    expect(applyCloudinaryDeliveryTransform(url, 'photo')).toBe(url);
  });

  it('leaves an empty string unchanged', () => {
    expect(applyCloudinaryDeliveryTransform('', 'photo')).toBe('');
  });
});
