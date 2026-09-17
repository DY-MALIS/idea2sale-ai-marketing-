import { describe, expect, it } from 'vitest';
import {
  addImageKitTransform,
  applyImageKitDeliveryTransform,
  applyImageKitMuteTransform,
  getOriginalImageKitUrl,
  normalizeImageKitVideoUrl,
} from '../../shared/imageKitUrl.js';

describe('ImageKit URL transformations', () => {
  it('mutes a hosted video without browser-side transcoding', () => {
    const result = applyImageKitMuteTransform('https://ik.imagekit.io/acme/video.mp4');
    expect(new URL(result).searchParams.get('tr')).toBe('ac-none');
  });

  it('preserves an existing delivery transformation and stays idempotent', () => {
    const original = 'https://ik.imagekit.io/acme/video.mp4?tr=w-1280%2Cq-70%2Cf-mp4';
    const once = applyImageKitMuteTransform(original);
    const twice = applyImageKitMuteTransform(once);
    expect(new URL(once).searchParams.get('tr')).toBe('w-1280,q-70,f-mp4:ac-none');
    expect(twice).toBe(once);
  });

  it('uses a numeric quality supported by ImageKit for video delivery', () => {
    const result = applyImageKitDeliveryTransform('https://ik.imagekit.io/acme/video.mp4', 'video');
    expect(new URL(result).searchParams.get('tr')).toBe('w-1280,q-85,f-mp4');
  });

  it('does not apply image transformations to narration audio', () => {
    const audio = 'https://ik.imagekit.io/acme/narration.mp3';
    expect(applyImageKitDeliveryTransform(audio, 'audio')).toBe(audio);
  });

  it('repairs persisted video URLs that used the invalid q-auto transform', () => {
    const legacy = 'https://ik.imagekit.io/acme/video.mp4?tr=w-1280%2Cq-auto%2Cf-mp4%3Aac-none&v=1';
    const repaired = normalizeImageKitVideoUrl(legacy);
    expect(new URL(repaired).searchParams.get('tr')).toBe('w-1280,q-85,f-mp4:ac-none');
    expect(new URL(repaired).searchParams.get('v')).toBe('1');
  });

  it('upgrades older q-70 playback URLs to preserve facial detail', () => {
    const legacy = 'https://ik.imagekit.io/acme/video.mp4?tr=w-1280%2Cq-70%2Cf-mp4';
    expect(new URL(normalizeImageKitVideoUrl(legacy)).searchParams.get('tr')).toBe('w-1280,q-85,f-mp4');
  });

  it('can fall back to the original asset while preserving unrelated query parameters', () => {
    const transformed = 'https://ik.imagekit.io/acme/video.mp4?tr=w-1280%2Cq-70%2Cf-mp4&v=1';
    const original = getOriginalImageKitUrl(transformed);
    expect(new URL(original).searchParams.has('tr')).toBe(false);
    expect(new URL(original).searchParams.get('v')).toBe('1');
  });

  it('does not transform an unrelated host', () => {
    const url = 'https://example.com/video.mp4';
    expect(addImageKitTransform(url, 'ac-none')).toBe(url);
  });
});
