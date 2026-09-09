import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { applyPosterTextOverlay } from '../../api/_posterOverlay.js';

const solidImageDataUrl = async (width = 400, height = 400, background = { r: 30, g: 30, b: 30 }) => {
  const buffer = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
};

const decode = async (dataUrl) => {
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, info };
};

const pixelAt = (raw, x, y) => {
  const i = (y * raw.info.width + x) * raw.info.channels;
  return [raw.data[i], raw.data[i + 1], raw.data[i + 2], raw.data[i + 3]];
};

describe('applyPosterTextOverlay', () => {
  it('returns the original image unchanged when there is no headline or CTA', async () => {
    const base = await solidImageDataUrl();
    const result = await applyPosterTextOverlay(base, '', '');
    expect(result).toBe(base);
  });

  it('draws a CTA pill in the configured accent color near the bottom', async () => {
    const base = await solidImageDataUrl(400, 400, { r: 20, g: 20, b: 20 });
    const result = await applyPosterTextOverlay(base, '', 'Learn More');
    const raw = await decode(result);
    expect(raw.info.width).toBe(400);
    expect(raw.info.height).toBe(400);
    const [r, g, b] = pixelAt(raw, 200, 364);
    // #f97316 accent color -- allow antialiasing/font-render slack.
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(90);
    expect(g).toBeLessThan(160);
    expect(b).toBeLessThan(60);
  });

  it('darkens the bottom of the image with a gradient when a headline is present', async () => {
    const base = await solidImageDataUrl(400, 400, { r: 200, g: 200, b: 200 });
    const result = await applyPosterTextOverlay(base, 'A short headline about the product', '');
    const raw = await decode(result);
    const [, , , topAlpha] = pixelAt(raw, 5, 5);
    expect(topAlpha).toBe(255);
    const topPixel = pixelAt(raw, 5, 5);
    const bottomPixel = pixelAt(raw, 5, 395);
    // The bottom strip is faded toward black; the untouched top strip is not.
    expect(bottomPixel[0]).toBeLessThan(topPixel[0]);
  });

  it('produces a same-size, decodable PNG for a non-square image', async () => {
    const base = await solidImageDataUrl(300, 500);
    const result = await applyPosterTextOverlay(base, 'Headline text here', 'Get Started');
    const raw = await decode(result);
    expect(raw.info.width).toBe(300);
    expect(raw.info.height).toBe(500);
  });

  it('falls back to the original image if it is not a data URL', async () => {
    const result = await applyPosterTextOverlay('https://example.com/photo.png', 'Headline', 'CTA');
    expect(result).toBe('https://example.com/photo.png');
  });
});
