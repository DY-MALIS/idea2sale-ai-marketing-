import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Mirrors src/components/PosterGen.tsx's overlayPosterText (browser Canvas 2D)
// so calendar-generated posters get the same headline/CTA treatment as the
// manual Poster tool. Serverless functions have no browser and no guaranteed
// system fonts (Vercel's runtime ships none, and librsvg's <style>@font-face
// src:url(data:...) embedding -- tried first -- silently falls back to
// whatever default font fontconfig finds instead of loading it). sharp's
// dedicated `text` input operator renders through Pango with an explicit
// `fontfile`, which does load an arbitrary on-disk font reliably regardless
// of what's registered on the host, so text is rendered there and shapes
// (gradient, CTA pill) are rendered separately via plain SVG.
const FONT_PATH = fileURLToPath(new URL('../assets/fonts/Inter-Bold.ttf', import.meta.url));
const FONT_FAMILY = 'Inter';

const HEADLINE_FONT_SIZE_RATIO = 0.052;
const CTA_FONT_SIZE_RATIO = 0.03;
const TEXT_MARGIN_RATIO = 0.06;
const CTA_ACCENT_COLOR = '#f97316';

const escapePango = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const renderText = async (text, fontSize, { width, align } = {}) => sharp({
  text: {
    text: `<span foreground="#ffffff">${escapePango(text)}</span>`,
    fontfile: FONT_PATH,
    font: `${FONT_FAMILY} Bold ${fontSize}px`,
    rgba: true,
    ...(width ? { width, align: align || 'center' } : {}),
  },
}).png().toBuffer({ resolveWithObject: true });

// Composites a headline and/or CTA pill onto the bottom of an AI-generated
// image, exactly like PosterGen.tsx's manual poster tool does client-side.
// Text is expected to be English/Latin script -- the embedded font has no
// Khmer glyph coverage, and the AI image prompt itself is separately told
// never to render literal on-image text (see PosterGen.tsx and the calendar
// prompt in api/ai.js), so this is the only place any text actually appears.
export async function applyPosterTextOverlay(imageDataUrl, headline = '', cta = '') {
  const headlineText = String(headline).trim();
  const ctaText = String(cta).trim();
  if (!headlineText && !ctaText) return imageDataUrl;

  const match = String(imageDataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return imageDataUrl;

  try {
    const baseBuffer = Buffer.from(match[2], 'base64');
    const baseImage = sharp(baseBuffer);
    const { width, height } = await baseImage.metadata();
    if (!width || !height) return imageDataUrl;

    const margin = Math.round(width * TEXT_MARGIN_RATIO);
    const maxTextWidth = width - margin * 2;

    const headlineFontSize = Math.round(width * HEADLINE_FONT_SIZE_RATIO);
    const ctaFontSize = Math.round(width * CTA_FONT_SIZE_RATIO);

    const headline_ = headlineText ? await renderText(headlineText, headlineFontSize, { width: maxTextWidth }) : null;
    const cta_ = ctaText ? await renderText(ctaText, ctaFontSize) : null;

    const ctaPaddingX = Math.round(ctaFontSize * 1.1);
    const ctaPaddingY = Math.round(ctaFontSize * 0.7);
    const ctaPillWidth = cta_ ? Math.min(cta_.info.width + ctaPaddingX * 2, maxTextWidth) : 0;
    const ctaPillHeight = cta_ ? cta_.info.height + ctaPaddingY * 2 : 0;

    const headlineHeight = headline_ ? headline_.info.height : 0;
    const gapBetween = headline_ && cta_ ? Math.round(margin * 0.6) : 0;
    const blockHeight = Math.round(headlineHeight + gapBetween + ctaPillHeight + margin * 1.5);
    const gradientTop = Math.max(0, height - blockHeight);

    const pillX = Math.round((width - ctaPillWidth) / 2);
    const pillY = Math.round(height - margin - ctaPillHeight);
    const radius = ctaPillHeight / 2;

    const shapesSvg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#000000" stop-opacity="0" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.72" />
          </linearGradient>
        </defs>
        <rect x="0" y="${gradientTop}" width="${width}" height="${height - gradientTop}" fill="url(#fade)" />
        ${cta_ ? `<rect x="${pillX}" y="${pillY}" width="${ctaPillWidth}" height="${ctaPillHeight}" rx="${radius}" fill="${CTA_ACCENT_COLOR}" />` : ''}
      </svg>
    `;

    const layers = [{ input: Buffer.from(shapesSvg), top: 0, left: 0 }];
    if (headline_) {
      const y = Math.round(height - margin - ctaPillHeight - gapBetween - headlineHeight);
      layers.push({ input: headline_.data, top: y, left: Math.round((width - headline_.info.width) / 2) });
    }
    if (cta_) {
      layers.push({
        input: cta_.data,
        top: Math.round(pillY + (ctaPillHeight - cta_.info.height) / 2),
        left: Math.round(pillX + (ctaPillWidth - cta_.info.width) / 2),
      });
    }

    const composited = await baseImage.composite(layers).png().toBuffer();
    return `data:image/png;base64,${composited.toString('base64')}`;
  } catch (error) {
    console.error('Poster text overlay failed, using the image without it:', error?.message || error);
    return imageDataUrl;
  }
}
