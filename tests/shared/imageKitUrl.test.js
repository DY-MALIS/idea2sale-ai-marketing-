import { describe, expect, it } from 'vitest';
import {
  addImageKitTransform,
  applyImageKitMuteTransform,
} from '../../shared/imageKitUrl.js';

describe('ImageKit URL transformations', () => {
  it('mutes a hosted video without browser-side transcoding', () => {
    const result = applyImageKitMuteTransform('https://ik.imagekit.io/acme/video.mp4');
    expect(new URL(result).searchParams.get('tr')).toBe('ac-none');
  });

  it('preserves an existing delivery transformation and stays idempotent', () => {
    const original = 'https://ik.imagekit.io/acme/video.mp4?tr=w-1280%2Cq-auto%2Cf-mp4';
    const once = applyImageKitMuteTransform(original);
    const twice = applyImageKitMuteTransform(once);
    expect(new URL(once).searchParams.get('tr')).toBe('w-1280,q-auto,f-mp4:ac-none');
    expect(twice).toBe(once);
  });

  it('does not transform an unrelated host', () => {
    const url = 'https://example.com/video.mp4';
    expect(addImageKitTransform(url, 'ac-none')).toBe(url);
  });
});
