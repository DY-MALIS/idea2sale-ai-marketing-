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
    const [r, g, b] = pixelAt(raw, 30, 364);
    // #f97316 accent color -- allow antialiasing/font-render slack.
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(90);
    expect(g).toBeLessThan(160);
    expect(b).toBeLessThan(60);
  }, 15_000); // Sharp font rendering can exceed Vitest's 5s default under full-suite load.

  it('frames the photo above a separate text panel', async () => {
    const base = await solidImageDataUrl(400, 400, { r: 200, g: 200, b: 200 });
    const result = await applyPosterTextOverlay(base, 'A short headline about the product', '');
    const raw = await decode(result);
    expect(pixelAt(raw, 5, 5)[0]).toBeLessThan(50);
    expect(pixelAt(raw, 200, 100)[0]).toBeGreaterThan(180);
    expect(pixelAt(raw, 200, 380)[0]).toBeLessThan(50);
  });

  it('renders Khmer headline and CTA with the bundled Khmer font', async () => {
    const base = await solidImageDataUrl(600, 800);
    const result = await applyPosterTextOverlay(base, 'រៀន AI ដើម្បីអនុវត្តក្នុងការងារពិត', 'ស្វែងយល់បន្ថែម');
    expect(result).not.toBe(base);
    const raw = await decode(result);
    const brightTextPixels = [];
    for (let y = 565; y < 720; y += 1) {
      for (let x = 30; x < 550; x += 1) {
        const [r, g, b] = pixelAt(raw, x, y);
        if (r > 220 && g > 220 && b > 220) brightTextPixels.push(1);
      }
    }
    expect(brightTextPixels.length).toBeGreaterThan(100);
  }, 15_000);

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
