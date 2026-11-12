import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// The image model supplies a photograph only. Keep exact text in its own
// panel. Pango's fontfile option shapes Khmer in Vercel's fontless runtime.
const LATIN_FONT = fileURLToPath(new URL('../assets/fonts/Inter-Bold.ttf', import.meta.url));
const KHMER_FONT = fileURLToPath(new URL('../assets/fonts/KantumruyPro.ttf', import.meta.url));
const BACKGROUND = '#102235';
const ACCENT = '#f97316';

const escapePango = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const renderText = async (value, size, width) => {
  const khmer = /[\u1780-\u17ff]/u.test(value);
  return sharp({
    text: {
      text: `<span foreground="#ffffff">${escapePango(value)}</span>`,
      fontfile: khmer ? KHMER_FONT : LATIN_FONT,
      font: `${khmer ? 'Kantumruy Pro' : 'Inter'} Bold ${size}px`,
      rgba: true,
      ...(width ? { width: Math.floor(width), align: 'left' } : {}),
    },
  }).png().toBuffer({ resolveWithObject: true });
};

const fitText = async (value, preferredSize, minSize, maxHeight, width) => {
  let rendered;
  for (let size = preferredSize; size >= minSize; size -= 2) {
    rendered = await renderText(value, size, width);
    if (rendered.info.height <= maxHeight && rendered.info.width <= width) break;
  }
  return rendered;
};

export async function applyPosterTextOverlay(imageDataUrl, headline = '', cta = '') {
  const headlineText = String(headline).trim().slice(0, 80);
  const ctaText = String(cta).trim().slice(0, 30);
  if (!headlineText && !ctaText) return imageDataUrl;
  const match = String(imageDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return imageDataUrl;

  try {
    const source = Buffer.from(match[2], 'base64');
    const { width, height } = await sharp(source).metadata();
    if (!width || !height) return imageDataUrl;

    const margin = Math.round(width * 0.055);
    const contentWidth = width - margin * 2;
    const photoHeight = Math.round(height * (height > width ? 0.62 : 0.54));
    const photoBottom = margin + photoHeight;
    const radius = Math.round(width * 0.025);
    const mask = Buffer.from(`<svg width="${contentWidth}" height="${photoHeight}"><rect width="${contentWidth}" height="${photoHeight}" rx="${radius}" fill="white"/></svg>`);
    const photo = await sharp(source)
      .resize(contentWidth, photoHeight, { fit: 'cover', position: 'attention' })
      .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();

    const ctaSize = Math.max(14, Math.round(width * 0.031));
    const ctaRender = ctaText
      ? await fitText(ctaText, ctaSize, Math.max(12, Math.round(ctaSize * 0.7)), height * 0.08, contentWidth * 0.72)
      : null;
    const ctaPaddingX = Math.round(width * 0.035);
    const ctaPaddingY = Math.round(width * 0.018);
    const pillWidth = ctaRender ? Math.min(contentWidth, ctaRender.info.width + ctaPaddingX * 2) : 0;
    const pillHeight = ctaRender ? ctaRender.info.height + ctaPaddingY * 2 : 0;
    const pillY = height - margin - pillHeight;
    const headlineY = photoBottom + Math.round(margin * 1.2);
    const maxHeadlineHeight = (ctaRender ? pillY - margin * 0.55 : height - margin) - headlineY;
    const headlineRender = headlineText
      ? await fitText(headlineText, Math.round(width * 0.06), Math.max(14, Math.round(width * 0.032)), maxHeadlineHeight, contentWidth * 0.86)
      : null;

    const decoration = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${margin}" y="${photoBottom + Math.round(margin * 0.55)}" width="${Math.round(width * 0.095)}" height="${Math.max(3, Math.round(width * 0.006))}" rx="2" fill="${ACCENT}" />
      ${ctaRender ? `<rect x="${margin}" y="${pillY}" width="${pillWidth}" height="${pillHeight}" rx="${pillHeight / 2}" fill="${ACCENT}" />` : ''}
    </svg>`);
    const layers = [{ input: photo, top: margin, left: margin }, { input: decoration, top: 0, left: 0 }];
    if (headlineRender) layers.push({ input: headlineRender.data, top: headlineY, left: margin });
    if (ctaRender) layers.push({
      input: ctaRender.data,
      top: Math.round(pillY + (pillHeight - ctaRender.info.height) / 2),
      left: Math.round(margin + (pillWidth - ctaRender.info.width) / 2),
    });
    const composed = await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
      .composite(layers).png().toBuffer();
    return `data:image/png;base64,${composed.toString('base64')}`;
  } catch (error) {
    console.error('Poster text layout failed, using the image without it:', error?.message || error);
    return imageDataUrl;
  }
}
