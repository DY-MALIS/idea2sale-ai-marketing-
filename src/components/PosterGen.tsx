import React, { useRef, useState } from 'react';
import {
  Sparkles,
  Image as ImageIcon,
  Download,
  Loader2,
  RefreshCw,
  Calendar
} from 'lucide-react';
import { cn } from '../lib/utils';
import PromptBuilder from './PromptBuilder';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { CreativeAutomationRequest, ScheduleHandoffRequest } from '../types';
import { getLatestBusinessBranding } from '../lib/businessBranding';
import { deleteGenerationHistory, GenerationHistoryEntry, saveGenerationHistory, useGenerationHistory } from '../lib/generationHistory';
import HistoryPanel from './HistoryPanel';

const LOGO_MARGIN_RATIO = 0.045;
const LOGO_WIDTH_RATIO = 0.12;

// Vercel gives api/ai.js up to 180s for slower image providers. Keep the browser
// deadline slightly longer so the function can return its real result/error,
// while still preventing a stalled connection from leaving the UI loading forever.
const IMAGE_GENERATE_TIMEOUT_MS = 190000;
const fetchImageGenerate = (body: unknown) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_GENERATE_TIMEOUT_MS);
  return fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));
};

const applyLogoWatermark = (baseDataUrl: string, logoDataUrl: string): Promise<string> => {
  if (!logoDataUrl) return Promise.resolve(baseDataUrl);
  return new Promise((resolve) => {
    const base = new Image();
    base.onload = () => {
      const logo = new Image();
      logo.onload = () => {
        // ctx.drawImage/canvas.toDataURL can throw (a tainted canvas from a
        // cross-origin/CORS-disallowed image source) -- that throw happens inside
        // this onload callback, not the Promise executor's synchronous body, so it
        // is never caught by the Promise machinery. Without this try/catch the
        // promise would just hang forever instead of resolving/rejecting, leaving
        // the caller's `await` -- and the whole generation UI -- stuck indefinitely.
        try {
          const canvas = document.createElement('canvas');
          canvas.width = base.width;
          canvas.height = base.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(baseDataUrl);
            return;
          }
          ctx.drawImage(base, 0, 0);
          const margin = Math.round(base.width * LOGO_MARGIN_RATIO);
          const badgeSize = Math.round(base.width * (LOGO_WIDTH_RATIO + 0.025));
          const logoMaxSize = Math.round(base.width * LOGO_WIDTH_RATIO);
          const scale = Math.min(logoMaxSize / logo.width, logoMaxSize / logo.height);
          const logoWidth = logo.width * scale;
          const logoHeight = logo.height * scale;
          const badgeX = base.width - margin - badgeSize;
          const radius = Math.round(badgeSize * 0.18);
          ctx.save();
          ctx.shadowColor = 'rgba(5, 15, 30, 0.25)';
          ctx.shadowBlur = Math.round(base.width * 0.018);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
          ctx.beginPath();
          ctx.roundRect(badgeX, margin, badgeSize, badgeSize, radius);
          ctx.fill();
          ctx.restore();
          ctx.drawImage(logo, badgeX + (badgeSize - logoWidth) / 2, margin + (badgeSize - logoHeight) / 2, logoWidth, logoHeight);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          console.error('Logo watermark failed, using the unwatermarked image:', error);
          resolve(baseDataUrl);
        }
      };
      logo.onerror = () => resolve(baseDataUrl);
      logo.src = logoDataUrl;
    };
    base.onerror = () => resolve(baseDataUrl);
    base.src = baseDataUrl;
  });
};

// AI image models cannot reliably render Khmer script at all (see
// NO_FOREIGN_TEXT_CONSTRAINT in api/ai.js -- confirmed live, it defaults to
// Thai/Chinese/garbled text every time). The only way to get real, correct
// Khmer headline/CTA text on a poster is to never ask the AI to render it
// and draw it ourselves afterward with an actual Khmer font -- "Kantumruy
// Pro" is already loaded app-wide (src/index.css) for the UI itself.
const POSTER_TEXT_FONT_FAMILY = '"Kantumruy Pro Poster", sans-serif';
const HEADLINE_FONT_SIZE_RATIO = 0.06;
const CTA_FONT_SIZE_RATIO = 0.031;
const TEXT_MARGIN_RATIO = 0.055;
const LINE_HEIGHT_RATIO = 1.28;
export type PosterLayout = 'product' | 'bold' | 'corporate' | 'card' | 'band' | 'fullbleed';

export interface PosterTheme {
  id: string;
  en: string;
  km: string;
  bg: string;
  accent: string;
  text: string;
  sub: string;
  // Text color drawn on top of the accent (CTA pill, offer badge).
  onAccent: string;
  // Solid studio background requested from the image model for the
  // "Product hero" layout.
  photoColor: string;
}

export const POSTER_THEMES: PosterTheme[] = [
  { id: 'navy', en: 'Navy & orange', km: 'ខៀវចាស់ និងទឹកក្រូច', bg: '#102235', accent: '#f97316', text: '#ffffff', sub: 'rgba(255,255,255,0.78)', onAccent: '#ffffff', photoColor: 'vivid orange' },
  { id: 'gold', en: 'Black & gold', km: 'ខ្មៅ និងមាស', bg: '#0b0b0d', accent: '#d4a646', text: '#ffffff', sub: 'rgba(255,255,255,0.75)', onAccent: '#111111', photoColor: 'deep black with warm golden rim light' },
  { id: 'red', en: 'White & red', km: 'ស និងក្រហម', bg: '#ffffff', accent: '#dc2626', text: '#111827', sub: '#4b5563', onAccent: '#ffffff', photoColor: 'bright red' },
  { id: 'green', en: 'Fresh green', km: 'បៃតងស្រស់', bg: '#0f2e1f', accent: '#22c55e', text: '#ffffff', sub: 'rgba(255,255,255,0.78)', onAccent: '#06210f', photoColor: 'fresh leafy green' },
  { id: 'pink', en: 'Beauty pink', km: 'ផ្កាឈូក', bg: '#fff1f5', accent: '#db2777', text: '#3b0a1f', sub: '#7a3352', onAccent: '#ffffff', photoColor: 'hot pink' },
  { id: 'tech', en: 'Tech blue', km: 'ខៀវបច្ចេកវិទ្យា', bg: '#06142e', accent: '#22d3ee', text: '#ffffff', sub: 'rgba(255,255,255,0.78)', onAccent: '#04202a', photoColor: 'electric cyan blue' },
];

export const findPosterTheme = (id?: string) => POSTER_THEMES.find((theme) => theme.id === id) || POSTER_THEMES[0];

export interface PosterOverlayOptions {
  layout?: PosterLayout;
  themeId?: string;
  offer?: string;
  info?: string;
  brand?: string;
}

const hexToRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = parseInt(full, 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${alpha})`;
};
const posterFontFamily = (text: string) => /[\u1780-\u17ff]/u.test(text)
  ? POSTER_TEXT_FONT_FAMILY
  : '"Inter", sans-serif';

const wrapCanvasText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
};

// Info is typed one item per line (date / time / place); "·" or "|" also split.
const splitInfoLines = (info: string) => info.split(/\n|·|\|/).map((line) => line.trim()).filter(Boolean).slice(0, 4);

const isKhmerText = (text: string) => /[ក-៿]/u.test(text);

// Big poster titles: condensed "Anton" for Latin text (the look of most
// product/event posters), the Khmer poster font for Khmer.
const displayFont = (size: number, text: string) => (isKhmerText(text)
  ? `700 ${size}px ${POSTER_TEXT_FONT_FAMILY}`
  : `400 ${size}px "Anton", "Inter", sans-serif`);

// Accent pill with centered text (CTA button). Returns its height.
const drawPill = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number, theme: PosterTheme, maxWidth: number, W: number) => {
  const padX = Math.round(W * 0.04);
  const padY = Math.round(W * 0.02);
  ctx.font = `800 ${fontSize}px ${posterFontFamily(text)}`;
  const width = Math.min(ctx.measureText(text).width + padX * 2, maxWidth);
  const height = fontSize * LINE_HEIGHT_RATIO + padY * 2;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = theme.onAccent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x + width / 2, y + padY, width - padX);
  return { width, height };
};

const pillSize = (ctx: CanvasRenderingContext2D, text: string, fontSize: number, maxWidth: number, W: number) => {
  ctx.font = `800 ${fontSize}px ${posterFontFamily(text)}`;
  return {
    width: Math.min(ctx.measureText(text).width + Math.round(W * 0.04) * 2, maxWidth),
    height: fontSize * LINE_HEIGHT_RATIO + Math.round(W * 0.02) * 2,
  };
};

const drawOfferBadge = (ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, diameter: number, theme: PosterTheme, W: number) => {
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = Math.round(W * 0.02);
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = theme.onAccent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let lines: string[] = [text];
  let size = Math.round(diameter * 0.28);
  for (; size >= Math.round(diameter * 0.11); size -= 1) {
    ctx.font = `800 ${size}px ${posterFontFamily(text)}`;
    lines = wrapCanvasText(ctx, text, diameter * 0.74);
    if (lines.length <= 3 && lines.length * size * 1.15 <= diameter * 0.7) break;
  }
  ctx.font = `800 ${size}px ${posterFontFamily(text)}`;
  const gap = size * 1.15;
  const startY = cy - ((Math.min(lines.length, 3) - 1) * gap) / 2;
  lines.slice(0, 3).forEach((line, index) => ctx.fillText(line, cx, startY + index * gap, diameter * 0.8));
};

// Draws `base` into a rectangle with object-fit: cover cropping.
const drawCover = (ctx: CanvasRenderingContext2D, base: HTMLImageElement, x: number, y: number, w: number, h: number) => {
  const scale = Math.max(w / base.width, h / base.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(base, (base.width - sw) / 2, (base.height - sh) / 2, sw, sh, x, y, w, h);
};

interface PosterContent {
  headline: string;
  cta: string;
  offer: string;
  infoLines: string[];
  brand: string;
  theme: PosterTheme;
}

// "Bold event" layout (event/club-flyer style): full-bleed photo, giant
// tilted headline at the top with the second line in an accent box, event
// info and the button centered at the bottom.
const drawBoldPoster = (ctx: CanvasRenderingContext2D, base: HTMLImageElement, W: number, H: number, c: PosterContent) => {
  const { theme } = c;
  const portrait = H > W;
  const m = Math.round(W * 0.06);
  drawCover(ctx, base, 0, 0, W, H);

  let gradient = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  gradient.addColorStop(0, hexToRgba(theme.bg, 0.88));
  gradient.addColorStop(1, hexToRgba(theme.bg, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H * 0.5);
  gradient = ctx.createLinearGradient(0, H * 0.52, 0, H);
  gradient.addColorStop(0, hexToRgba(theme.bg, 0));
  gradient.addColorStop(0.55, hexToRgba(theme.bg, 0.88));
  gradient.addColorStop(1, hexToRgba(theme.bg, 0.97));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, H * 0.52, W, H * 0.48);

  // Decorative accent strokes in two corners.
  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, Math.round(W * 0.014));
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(W * 0.8, H * 0.36); ctx.lineTo(W * 0.96, H * 0.28);
  ctx.moveTo(W * 0.84, H * 0.39); ctx.lineTo(W * 0.96, H * 0.33);
  ctx.moveTo(W * 0.04, H * 0.62); ctx.lineTo(W * 0.16, H * 0.56);
  ctx.stroke();
  ctx.restore();

  let top = m;
  if (c.brand) {
    const brandSize = Math.max(12, Math.round(W * 0.03));
    ctx.font = `800 ${brandSize}px ${posterFontFamily(c.brand)}`;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(isKhmerText(c.brand) ? c.brand : c.brand.toUpperCase(), m, top, W * 0.6);
    top += Math.round(brandSize * 1.9);
  }

  let headlineBottom = top;
  if (c.headline) {
    const khmer = isKhmerText(c.headline);
    const text = khmer ? c.headline : c.headline.toUpperCase();
    const lineFactor = khmer ? 1.4 : 1.04;
    const maxW = W - m * 2;
    let size = Math.round(W * (portrait ? 0.17 : 0.1));
    let lines: string[] = [text];
    for (; size >= Math.round(W * 0.055); size -= 2) {
      ctx.font = displayFont(size, text);
      lines = wrapCanvasText(ctx, text, maxW * 0.92);
      if (lines.length <= 3 && lines.length * size * lineFactor <= H * (portrait ? 0.32 : 0.42)) break;
    }
    lines = lines.slice(0, 3);
    const lineH = size * lineFactor;
    ctx.save();
    ctx.translate(m, top);
    ctx.rotate(-0.05);
    ctx.font = displayFont(size, text);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      const y = index * lineH;
      const boxed = lines.length >= 2 && index === 1;
      if (boxed) {
        const pad = Math.round(size * 0.14);
        const width = Math.min(ctx.measureText(line).width, maxW);
        ctx.fillStyle = theme.accent;
        ctx.fillRect(-pad, y - pad * 0.35, width + pad * 2, lineH + pad * 0.1);
        ctx.fillStyle = theme.onAccent;
        ctx.fillText(line, 0, y, maxW);
      } else {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = Math.round(W * 0.012);
        ctx.fillStyle = theme.text;
        ctx.fillText(line, 0, y, maxW);
        ctx.shadowBlur = 0;
      }
    });
    ctx.restore();
    headlineBottom = top + lines.length * lineH + W * 0.06;
  }

  if (c.offer) {
    const diameter = Math.max(64, Math.round(W * (portrait ? 0.22 : 0.15)));
    drawOfferBadge(ctx, c.offer, W - m - diameter / 2, Math.min(headlineBottom + diameter * 0.6, H * 0.5), diameter, theme, W);
  }

  // Bottom block, laid out from the bottom up.
  let bottom = H - m;
  if (c.cta) {
    const ctaSize = Math.max(14, Math.round(W * 0.036));
    const size = pillSize(ctx, c.cta, ctaSize, W - m * 2, W);
    drawPill(ctx, c.cta, (W - size.width) / 2, bottom - size.height, ctaSize, theme, W - m * 2, W);
    bottom -= size.height + Math.round(m * 0.6);
  }
  if (c.infoLines.length) {
    const infoSize = Math.max(12, Math.round(W * 0.032));
    const lineH = Math.round(infoSize * 1.35);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const startY = bottom - c.infoLines.length * lineH;
    c.infoLines.forEach((line, index) => {
      ctx.font = `${index === 0 ? 800 : 600} ${index === 0 ? Math.round(infoSize * 1.12) : infoSize}px ${posterFontFamily(line)}`;
      ctx.fillStyle = index === 0 ? theme.text : theme.sub;
      ctx.fillText(line, W / 2, startY + index * lineH, W - m * 2);
    });
    const barW = Math.round(W * 0.12);
    ctx.fillStyle = theme.accent;
    ctx.fillRect((W - barW) / 2, startY - Math.round(m * 0.5), barW, Math.max(3, Math.round(W * 0.007)));
  }
};

// "Product hero" layout (food/drink product poster style): the AI photo is a
// studio shot of the product on a solid color matching the theme accent;
// giant centered condensed title on top, offer badge, details and button at
// the bottom. Badge/button use the theme background color so they stand out
// against the accent-colored photo.
const drawProductPoster = (ctx: CanvasRenderingContext2D, base: HTMLImageElement, W: number, H: number, c: PosterContent) => {
  const { theme } = c;
  const portrait = H > W;
  const m = Math.round(W * 0.06);
  const contrast: PosterTheme = { ...theme, accent: theme.bg, onAccent: theme.text };
  drawCover(ctx, base, 0, 0, W, H);

  let gradient = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.28)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H * 0.4);
  gradient = ctx.createLinearGradient(0, H * 0.72, 0, H);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, H * 0.72, W, H * 0.28);

  let top = m;
  if (c.brand) {
    const brandSize = Math.max(12, Math.round(W * 0.03));
    ctx.font = `800 ${brandSize}px ${posterFontFamily(c.brand)}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(isKhmerText(c.brand) ? c.brand : c.brand.toUpperCase(), W / 2, top, W * 0.6);
    top += Math.round(brandSize * 1.8);
  }

  let headlineBottom = top;
  if (c.headline) {
    const khmer = isKhmerText(c.headline);
    const text = khmer ? c.headline : c.headline.toUpperCase();
    const lineFactor = khmer ? 1.4 : 1.02;
    const maxW = W - m * 2;
    let size = Math.round(W * (portrait ? 0.2 : 0.11));
    let lines: string[] = [text];
    for (; size >= Math.round(W * 0.06); size -= 2) {
      ctx.font = displayFont(size, text);
      lines = wrapCanvasText(ctx, text, maxW);
      if (lines.length <= 3 && lines.length * size * lineFactor <= H * (portrait ? 0.3 : 0.4)) break;
    }
    lines = lines.slice(0, 3);
    ctx.font = displayFont(size, text);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((line, index) => {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = Math.round(W * 0.015);
      ctx.fillStyle = index === 1 && lines.length >= 2 ? theme.bg : '#ffffff';
      ctx.fillText(line, W / 2, top + index * size * lineFactor, maxW);
    });
    ctx.shadowBlur = 0;
    headlineBottom = top + lines.length * size * lineFactor;
  }

  if (c.offer) {
    const diameter = Math.max(64, Math.round(W * (portrait ? 0.22 : 0.15)));
    drawOfferBadge(ctx, c.offer, W - m - diameter / 2, Math.min(headlineBottom + diameter * 0.75, H * 0.55), diameter, contrast, W);
  }

  let bottom = H - m;
  if (c.cta) {
    const ctaSize = Math.max(14, Math.round(W * 0.036));
    const size = pillSize(ctx, c.cta, ctaSize, W - m * 2, W);
    drawPill(ctx, c.cta, (W - size.width) / 2, bottom - size.height, ctaSize, contrast, W - m * 2, W);
    bottom -= size.height + Math.round(m * 0.55);
  }
  if (c.infoLines.length) {
    const infoSize = Math.max(12, Math.round(W * 0.03));
    const lineH = Math.round(infoSize * 1.35);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = Math.round(W * 0.01);
    const startY = bottom - c.infoLines.length * lineH;
    c.infoLines.forEach((line, index) => {
      ctx.font = `${index === 0 ? 800 : 600} ${infoSize}px ${posterFontFamily(line)}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, W / 2, startY + index * lineH, W - m * 2);
    });
    ctx.shadowBlur = 0;
  }
};

// "Business" layout (corporate flyer style): photo on top, a slanted accent
// stripe and color panel, big headline bottom-left, info list with accent
// dots on the right, button bottom-left and brand bottom-right.
const drawCorporatePoster = (ctx: CanvasRenderingContext2D, base: HTMLImageElement, W: number, H: number, c: PosterContent) => {
  const { theme } = c;
  const portrait = H > W;
  const m = Math.round(W * 0.06);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  const photoH = Math.round(H * (portrait ? 0.62 : 0.66));
  drawCover(ctx, base, 0, 0, W, photoH);

  const yLeft = photoH - H * 0.01;
  const yRight = photoH - H * (portrait ? 0.11 : 0.16);
  const stripe = Math.max(6, Math.round(W * 0.022));
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(0, yLeft - stripe); ctx.lineTo(W, yRight - stripe); ctx.lineTo(W, yRight); ctx.lineTo(0, yLeft);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = theme.bg;
  ctx.beginPath();
  ctx.moveTo(0, yLeft); ctx.lineTo(W, yRight); ctx.lineTo(W, H); ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  if (c.offer) {
    const diameter = Math.max(64, Math.round(W * (portrait ? 0.2 : 0.14)));
    drawOfferBadge(ctx, c.offer, W - m - diameter / 2, yRight - stripe - diameter * 0.55, diameter, theme, W);
  }

  const ctaSize = Math.max(14, Math.round(W * 0.032));
  const cta = c.cta ? pillSize(ctx, c.cta, ctaSize, W * 0.5, W) : { width: 0, height: 0 };
  const footerTop = H - m - (cta.height || Math.round(W * 0.04));
  const top = yLeft + Math.round(m * 0.7);
  const hasInfo = c.infoLines.length > 0;
  const headlineW = hasInfo ? W * 0.54 : W - m * 2;

  ctx.fillStyle = theme.accent;
  ctx.fillRect(m, top, Math.round(W * 0.1), Math.max(3, Math.round(W * 0.007)));
  const textTop = top + Math.round(m * 0.45);

  if (c.headline) {
    const khmer = isKhmerText(c.headline);
    const text = khmer ? c.headline : c.headline.toUpperCase();
    const lineFactor = khmer ? 1.38 : 1.08;
    const room = footerTop - Math.round(m * 0.6) - textTop;
    let size = Math.round(W * (portrait ? 0.1 : 0.07));
    let lines: string[] = [text];
    for (; size >= Math.round(W * 0.045); size -= 2) {
      ctx.font = displayFont(size, text);
      lines = wrapCanvasText(ctx, text, headlineW);
      if (lines.length <= 4 && lines.length * size * lineFactor <= room) break;
    }
    ctx.font = displayFont(size, text);
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.slice(0, 4).forEach((line, index) => ctx.fillText(line, m, textTop + index * size * lineFactor, headlineW));
  }

  if (hasInfo) {
    const x = W * 0.62;
    const width = W - x - m;
    const infoSize = Math.max(11, Math.round(W * 0.03));
    const lineH = Math.round(infoSize * 1.32);
    let y = textTop + Math.round(infoSize * 0.2);
    for (const item of c.infoLines) {
      ctx.font = `600 ${infoSize}px ${posterFontFamily(item)}`;
      const wrapped = wrapCanvasText(ctx, item, width - infoSize * 1.1).slice(0, 2);
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(x + infoSize * 0.3, y + lineH * 0.45, infoSize * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      wrapped.forEach((line, index) => ctx.fillText(line, x + infoSize * 1.1, y + index * lineH, width - infoSize * 1.1));
      y += wrapped.length * lineH + Math.round(infoSize * 0.7);
      if (y > footerTop - lineH) break;
    }
  }

  if (c.cta) drawPill(ctx, c.cta, m, H - m - cta.height, ctaSize, theme, W * 0.5, W);
  if (c.brand) {
    const brandSize = Math.max(11, Math.round(W * 0.026));
    ctx.font = `700 ${brandSize}px ${posterFontFamily(c.brand)}`;
    ctx.fillStyle = theme.sub;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.brand, W - m, H - m - (cta.height || brandSize) / 2, W * 0.4);
  }
};

const overlayPosterText = async (baseDataUrl: string, headline: string, cta: string, options: PosterOverlayOptions = {}): Promise<string> => {
  const headlineText = headline.trim();
  const ctaText = cta.trim();
  const offerText = (options.offer || '').trim();
  const infoLinesAll = splitInfoLines(options.info || '');
  const infoText = infoLinesAll.join(' · ');
  const brandText = (options.brand || '').trim();
  const layout: PosterLayout = options.layout || 'bold';
  const theme = findPosterTheme(options.themeId);
  if (!headlineText && !ctaText && !offerText && !infoText) return baseDataUrl;

  try {
    if (typeof document !== 'undefined' && (document as any).fonts?.load) {
      await Promise.all([
        (document as any).fonts.load(`700 48px ${POSTER_TEXT_FONT_FAMILY}`),
        (document as any).fonts.load(`700 24px ${POSTER_TEXT_FONT_FAMILY}`),
        (document as any).fonts.load('700 48px "Inter"'),
        (document as any).fonts.load('900 48px "Inter"'),
        (document as any).fonts.load('400 48px "Anton"'),
      ]);
    }
  } catch {
    // Font Loading API not available/failed -- proceed anyway, the browser
    // falls back to its default font rather than failing the whole overlay.
  }

  return new Promise((resolve) => {
    const base = new Image();
    base.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = base.width;
        canvas.height = base.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(baseDataUrl);
          return;
        }
        const W = base.width;
        const H = base.height;
        if (layout === 'bold' || layout === 'corporate' || layout === 'product') {
          const content: PosterContent = { headline: headlineText, cta: ctaText, offer: offerText, infoLines: infoLinesAll, brand: brandText, theme };
          if (layout === 'bold') drawBoldPoster(ctx, base, W, H, content);
          else if (layout === 'product') drawProductPoster(ctx, base, W, H, content);
          else drawCorporatePoster(ctx, base, W, H, content);
          resolve(canvas.toDataURL('image/png'));
          return;
        }
        const portrait = H > W;
        const margin = Math.round(W * TEXT_MARGIN_RATIO);
        const maxTextWidth = W - margin * 2;
        const centered = layout === 'band';

        // Photo rectangle per layout:
        // - card: framed rounded photo on top, text panel below (exact copy
        //   never covers a face or product)
        // - band: edge-to-edge photo on top, solid color band with centered text
        // - fullbleed: photo fills the poster, text sits on a gradient fade
        const photo = layout === 'fullbleed'
          ? { x: 0, y: 0, w: W, h: H, r: 0 }
          : layout === 'band'
            ? { x: 0, y: 0, w: W, h: Math.round(H * (portrait ? 0.64 : 0.58)), r: 0 }
            : { x: margin, y: margin, w: maxTextWidth, h: Math.round(H * (portrait ? 0.62 : 0.54)), r: Math.round(W * 0.025) };
        const photoBottom = photo.y + photo.h;

        ctx.fillStyle = theme.bg;
        ctx.fillRect(0, 0, W, H);
        const scale = Math.max(photo.w / W, photo.h / H);
        const sourceWidth = photo.w / scale;
        const sourceHeight = photo.h / scale;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(photo.x, photo.y, photo.w, photo.h, photo.r);
        ctx.clip();
        ctx.drawImage(base, (W - sourceWidth) / 2, (H - sourceHeight) / 2,
          sourceWidth, sourceHeight, photo.x, photo.y, photo.w, photo.h);
        ctx.restore();

        if (layout === 'fullbleed') {
          const gradient = ctx.createLinearGradient(0, H * 0.34, 0, H);
          gradient.addColorStop(0, hexToRgba(theme.bg, 0));
          gradient.addColorStop(0.45, hexToRgba(theme.bg, 0.86));
          gradient.addColorStop(1, hexToRgba(theme.bg, 0.97));
          ctx.fillStyle = gradient;
          ctx.fillRect(0, H * 0.34, W, H * 0.66);
        }

        ctx.textBaseline = 'top';
        const textX = centered ? W / 2 : margin;
        ctx.textAlign = centered ? 'center' : 'left';
        const textTop = layout === 'fullbleed'
          ? Math.round(H * (portrait ? 0.6 : 0.52))
          : photoBottom + Math.round(margin * (layout === 'band' ? 1.1 : 1.2));

        const ctaFontSize = Math.max(14, Math.round(W * CTA_FONT_SIZE_RATIO));
        const ctaPaddingX = Math.round(W * 0.035);
        const ctaPaddingY = Math.round(W * 0.018);
        let ctaPillWidth = 0;
        let ctaPillHeight = 0;
        if (ctaText) {
          ctx.font = `700 ${ctaFontSize}px ${posterFontFamily(ctaText)}`;
          ctaPillWidth = Math.min(ctx.measureText(ctaText).width + ctaPaddingX * 2, maxTextWidth);
          ctaPillHeight = ctaFontSize * LINE_HEIGHT_RATIO + ctaPaddingY * 2;
        }
        const pillY = H - margin - ctaPillHeight;

        // Small info line (date, location, phone) under the headline.
        const infoFontSize = Math.max(12, Math.round(W * 0.028));
        const infoLineHeight = Math.round(infoFontSize * LINE_HEIGHT_RATIO);
        let infoLines: string[] = [];
        if (infoText) {
          ctx.font = `500 ${infoFontSize}px ${posterFontFamily(infoText)}`;
          infoLines = wrapCanvasText(ctx, infoText, maxTextWidth * 0.9).slice(0, 2);
        }
        const infoBlock = infoLines.length ? infoLines.length * infoLineHeight + Math.round(margin * 0.35) : 0;

        const headlineRoom = (ctaText ? pillY - margin * 0.55 : H - margin) - textTop - infoBlock;
        let headlineFontSize = Math.round(W * HEADLINE_FONT_SIZE_RATIO);
        let headlineLineHeight = Math.round(headlineFontSize * LINE_HEIGHT_RATIO);
        let headlineLines: string[] = [];
        const headlineWidth = maxTextWidth * (centered ? 0.92 : 0.86);
        if (headlineText) {
          for (let size = headlineFontSize; size >= Math.max(14, Math.round(W * 0.032)); size -= 2) {
            ctx.font = `700 ${size}px ${posterFontFamily(headlineText)}`;
            const lines = wrapCanvasText(ctx, headlineText, headlineWidth);
            headlineFontSize = size;
            headlineLineHeight = Math.round(size * LINE_HEIGHT_RATIO);
            headlineLines = lines;
            if (lines.length * headlineLineHeight <= headlineRoom) break;
          }
        }

        // Accent bar above the headline.
        const barWidth = Math.round(W * 0.095);
        const barHeight = Math.max(3, Math.round(W * 0.006));
        ctx.fillStyle = theme.accent;
        ctx.fillRect(centered ? (W - barWidth) / 2 : margin, textTop - Math.round(margin * 0.62), barWidth, barHeight);

        let y = textTop;
        if (headlineLines.length) {
          ctx.font = `700 ${headlineFontSize}px ${posterFontFamily(headlineText)}`;
          ctx.fillStyle = theme.text;
          for (const line of headlineLines) {
            ctx.fillText(line, textX, y, headlineWidth);
            y += headlineLineHeight;
          }
        }
        if (infoLines.length) {
          y += Math.round(margin * 0.35);
          ctx.font = `500 ${infoFontSize}px ${posterFontFamily(infoText)}`;
          ctx.fillStyle = theme.sub;
          for (const line of infoLines) {
            ctx.fillText(line, textX, y, maxTextWidth * 0.9);
            y += infoLineHeight;
          }
        }

        if (ctaText) {
          const pillX = centered ? (W - ctaPillWidth) / 2 : margin;
          const radius = ctaPillHeight / 2;
          ctx.fillStyle = theme.accent;
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, ctaPillWidth, ctaPillHeight, radius);
          ctx.fill();

          ctx.font = `700 ${ctaFontSize}px ${posterFontFamily(ctaText)}`;
          ctx.fillStyle = theme.onAccent;
          ctx.textAlign = 'center';
          ctx.fillText(ctaText, pillX + ctaPillWidth / 2,
            pillY + (ctaPillHeight - ctaFontSize * LINE_HEIGHT_RATIO) / 2,
            ctaPillWidth - ctaPaddingX);
        }

        // Round offer badge (e.g. "-30%") on the top-left of the photo; the
        // logo watermark is added later at the top-right.
        if (offerText) {
          const diameter = Math.max(64, Math.round(W * (portrait ? 0.22 : 0.17)));
          const inset = layout === 'card' ? Math.round(margin * 0.6) : margin;
          const cx = photo.x + inset + diameter / 2;
          const cy = photo.y + inset + diameter / 2;
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
          ctx.shadowBlur = Math.round(W * 0.02);
          ctx.fillStyle = theme.accent;
          ctx.beginPath();
          ctx.arc(cx, cy, diameter / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = theme.onAccent;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          let badgeLines: string[] = [offerText];
          let badgeSize = Math.round(diameter * 0.28);
          for (; badgeSize >= Math.round(diameter * 0.11); badgeSize -= 1) {
            ctx.font = `800 ${badgeSize}px ${posterFontFamily(offerText)}`;
            badgeLines = wrapCanvasText(ctx, offerText, diameter * 0.74);
            if (badgeLines.length <= 3 && badgeLines.length * badgeSize * 1.15 <= diameter * 0.7) break;
          }
          ctx.font = `800 ${badgeSize}px ${posterFontFamily(offerText)}`;
          const lineGap = badgeSize * 1.15;
          const startY = cy - ((badgeLines.length - 1) * lineGap) / 2;
          badgeLines.slice(0, 3).forEach((line, index) => {
            ctx.fillText(line, cx, startY + index * lineGap, diameter * 0.8);
          });
        }

        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        console.error('Poster text overlay failed, using the image without it:', error);
        resolve(baseDataUrl);
      }
    };
    base.onerror = () => resolve(baseDataUrl);
    base.src = baseDataUrl;
  });
};

const posterInputClass = 'w-full p-3 rounded-xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100';

// Tiny schematic of each poster layout for the layout picker.
const LayoutThumb: React.FC<{ layout: PosterLayout }> = ({ layout }) => (
  <span className="relative mx-auto block h-16 w-11 overflow-hidden rounded-md bg-slate-700" aria-hidden="true">
    {layout === 'product' && (
      <>
        <span className="absolute inset-0 bg-orange-500" />
        <span className="absolute left-1/2 top-1.5 h-2 w-8 -translate-x-1/2 rounded-sm bg-white" />
        <span className="absolute left-1/2 top-4 h-2 w-6 -translate-x-1/2 rounded-sm bg-slate-800" />
        <span className="absolute left-1/2 top-7 h-5 w-4 -translate-x-1/2 rounded-b-lg rounded-t-sm bg-amber-100 shadow" />
        <span className="absolute right-1 top-7 h-3 w-3 rounded-full bg-slate-800" />
        <span className="absolute bottom-1 left-1/2 h-1.5 w-4 -translate-x-1/2 rounded-full bg-slate-800" />
      </>
    )}
    {layout === 'bold' && (
      <>
        <span className="absolute inset-0 bg-gradient-to-br from-sky-400 to-indigo-700" />
        <span className="absolute left-1 top-1.5 h-2 w-8 -rotate-6 rounded-sm bg-white" />
        <span className="absolute left-1.5 top-4 h-2 w-5 -rotate-6 rounded-sm bg-orange-500" />
        <span className="absolute bottom-3.5 left-1/2 h-1 w-6 -translate-x-1/2 rounded bg-white/80" />
        <span className="absolute bottom-1 left-1/2 h-1.5 w-4 -translate-x-1/2 rounded-full bg-orange-500" />
      </>
    )}
    {layout === 'corporate' && (
      <>
        <span className="absolute inset-x-0 top-0 h-10 bg-gradient-to-br from-amber-300 to-orange-500" />
        <span className="absolute inset-x-0 bottom-0 top-7 bg-slate-700 [clip-path:polygon(0_45%,100%_0,100%_100%,0_100%)]" />
        <span className="absolute left-1 top-11 h-1.5 w-5 rounded-sm bg-white" />
        <span className="absolute left-1 top-[3.05rem] h-1.5 w-4 rounded-sm bg-white" />
        <span className="absolute right-1 top-11 h-0.5 w-3 rounded bg-white/60" />
        <span className="absolute right-1 top-12 h-0.5 w-3 rounded bg-white/60" />
        <span className="absolute bottom-1 left-1 h-1.5 w-4 rounded-full bg-orange-500" />
      </>
    )}
    {layout === 'card' && (
      <>
        <span className="absolute left-1 right-1 top-1 h-8 rounded-sm bg-gradient-to-br from-amber-300 to-orange-500" />
        <span className="absolute left-1.5 top-10 h-1 w-6 rounded bg-white/90" />
        <span className="absolute left-1.5 top-12 h-1 w-4 rounded bg-white/60" />
        <span className="absolute bottom-1 left-1.5 h-1.5 w-4 rounded-full bg-orange-500" />
      </>
    )}
    {layout === 'band' && (
      <>
        <span className="absolute inset-x-0 top-0 h-10 bg-gradient-to-br from-amber-300 to-orange-500" />
        <span className="absolute left-1/2 top-11 h-1 w-6 -translate-x-1/2 rounded bg-white/90" />
        <span className="absolute left-1/2 top-[3.15rem] h-1 w-4 -translate-x-1/2 rounded bg-white/60" />
        <span className="absolute bottom-1 left-1/2 h-1.5 w-4 -translate-x-1/2 rounded-full bg-orange-500" />
      </>
    )}
    {layout === 'fullbleed' && (
      <>
        <span className="absolute inset-0 bg-gradient-to-br from-amber-300 to-orange-500" />
        <span className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-slate-800 to-transparent" />
        <span className="absolute bottom-5 left-1.5 h-1 w-6 rounded bg-white/90" />
        <span className="absolute bottom-3.5 left-1.5 h-1 w-4 rounded bg-white/60" />
        <span className="absolute bottom-1 left-1.5 h-1.5 w-4 rounded-full bg-orange-500" />
      </>
    )}
  </span>
);

// Live, approximate preview of the final poster (layout, colors and text).
// The real photo comes from AI, so a soft gradient stands in for it.
const PosterPreview: React.FC<{ details: PosterDetails; aspectRatio: ImageAspectRatio; km: boolean }> = ({ details, aspectRatio, km }) => {
  const theme = findPosterTheme(details.theme);
  const centered = details.layout === 'band';
  const ratio = aspectRatio === '16:9' ? '16 / 9' : aspectRatio === '1:1' ? '1 / 1' : '9 / 16';
  const width = aspectRatio === '16:9' ? 'w-full' : aspectRatio === '1:1' ? 'w-56' : 'w-44';
  const photoHeight = details.layout === 'fullbleed' ? '100%' : details.layout === 'band' ? (aspectRatio === '9:16' ? '64%' : '58%') : (aspectRatio === '9:16' ? '62%' : '54%');
  const headline = details.headline.trim() || (km ? 'ចំណងជើងរបស់អ្នក' : 'Your headline');
  const infoLines = splitInfoLines(details.info);
  const title = isKhmerText(headline) ? headline : headline.toUpperCase();
  const titleStyle = isKhmerText(headline) ? { fontFamily: POSTER_TEXT_FONT_FAMILY, fontWeight: 700 } : { fontFamily: '"Anton", "Inter", sans-serif' };
  const offer = details.offer.trim();
  const cta = details.cta.trim();

  if (details.layout === 'product' || details.layout === 'bold') {
    const product = details.layout === 'product';
    const words = title.split(/\s+/);
    const firstHalf = words.slice(0, Math.ceil(words.length / 2)).join(' ');
    const secondHalf = words.slice(Math.ceil(words.length / 2)).join(' ');
    return (
      <div
        className={cn('relative mx-auto overflow-hidden rounded-xl shadow-lg', width)}
        style={{ aspectRatio: ratio, background: product ? theme.accent : `linear-gradient(160deg, ${theme.bg}, #64748b 55%, ${theme.bg})` }}
      >
        {product && <span className="absolute bottom-[22%] left-1/2 h-[34%] w-[34%] -translate-x-1/2 rounded-b-[40%] rounded-t-lg bg-white/85 shadow-xl" />}
        {!product && <span className="absolute bottom-[18%] left-1/2 h-[48%] w-[42%] -translate-x-1/2 rounded-t-full bg-white/25" />}
        <span className="absolute bottom-[30%] left-1/2 -translate-x-1/2 text-[9px] font-semibold text-white/80">{km ? 'រូបថត AI' : 'AI photo'}</span>
        <div className={cn('absolute inset-x-[6%] top-[5%] leading-[1.02]', product ? 'text-center' : '-rotate-3 text-left')} style={titleStyle}>
          {details.brand.trim() && <p className="mb-1 font-sans text-[8px] font-extrabold tracking-wider text-white">{details.brand.trim().toUpperCase()}</p>}
          <p className="text-2xl text-white drop-shadow">{firstHalf}</p>
          {secondHalf && (
            product
              ? <p className="text-2xl" style={{ color: theme.bg }}>{secondHalf}</p>
              : <p className="inline-block px-1 text-2xl" style={{ background: theme.accent, color: theme.onAccent }}>{secondHalf}</p>
          )}
        </div>
        {offer && (
          <span
            className="absolute right-[6%] top-[40%] flex h-12 w-12 items-center justify-center rounded-full p-1 text-center text-[9px] font-extrabold leading-tight shadow"
            style={product ? { background: theme.bg, color: theme.text } : { background: theme.accent, color: theme.onAccent }}
          >
            {offer}
          </span>
        )}
        <div className="absolute inset-x-[6%] bottom-[4%] flex flex-col items-center gap-0.5 text-center">
          {infoLines.map((line, index) => (
            <span key={index} className={cn('line-clamp-1 text-[8px] text-white drop-shadow', index === 0 && 'font-extrabold')}>{line}</span>
          ))}
          {cta && (
            <span
              className="mt-1 rounded-full px-2.5 py-1 text-[9px] font-bold"
              style={product ? { background: theme.bg, color: theme.text } : { background: theme.accent, color: theme.onAccent }}
            >
              {cta}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (details.layout === 'corporate') {
    return (
      <div className={cn('relative mx-auto overflow-hidden rounded-xl shadow-lg', width)} style={{ aspectRatio: ratio, background: theme.bg }}>
        <div className="absolute inset-x-0 top-0 h-[62%] bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400">
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white/80">{km ? 'រូបថត AI' : 'AI photo'}</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 top-[50%] [clip-path:polygon(0_22%,100%_0,100%_100%,0_100%)]" style={{ background: theme.accent }} />
        <div className="absolute inset-x-0 bottom-0 top-[52%] [clip-path:polygon(0_24%,100%_0,100%_100%,0_100%)]" style={{ background: theme.bg }} />
        <div className="absolute left-[6%] top-[66%] w-[54%]">
          <span className="mb-1 block h-0.5 w-6 rounded" style={{ background: theme.accent }} />
          <p className="line-clamp-3 text-base leading-[1.05]" style={{ ...titleStyle, color: theme.text }}>{title}</p>
        </div>
        {infoLines.length > 0 && (
          <div className="absolute right-[5%] top-[67%] w-[32%] space-y-1">
            {infoLines.map((line, index) => (
              <p key={index} className="flex items-start gap-1 text-[8px] leading-tight" style={{ color: theme.sub }}>
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: theme.accent }} />
                <span className="line-clamp-2">{line}</span>
              </p>
            ))}
          </div>
        )}
        {cta && (
          <span className="absolute bottom-[4%] left-[6%] rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ background: theme.accent, color: theme.onAccent }}>{cta}</span>
        )}
        {offer && (
          <span className="absolute right-[6%] top-[34%] flex h-11 w-11 items-center justify-center rounded-full p-1 text-center text-[8px] font-extrabold leading-tight shadow" style={{ background: theme.accent, color: theme.onAccent }}>{offer}</span>
        )}
      </div>
    );
  }

  return (
    <div className={cn('relative mx-auto overflow-hidden rounded-xl shadow-lg', width)} style={{ aspectRatio: ratio, background: theme.bg }}>
      <div
        className={cn('absolute bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400', details.layout === 'card' ? 'left-[5.5%] right-[5.5%] top-[4%] rounded-lg' : 'inset-x-0 top-0')}
        style={{ height: photoHeight }}
      >
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white/80">
          {km ? 'រូបថត AI' : 'AI photo'}
        </span>
      </div>
      {details.layout === 'fullbleed' && (
        <div className="absolute inset-x-0 bottom-0 h-2/3" style={{ background: `linear-gradient(to top, ${theme.bg} 45%, transparent)` }} />
      )}
      {details.offer.trim() && (
        <span
          className="absolute left-[8%] top-[6%] flex h-12 w-12 items-center justify-center rounded-full p-1 text-center text-[9px] font-extrabold leading-tight shadow"
          style={{ background: theme.accent, color: theme.onAccent }}
        >
          {details.offer.trim()}
        </span>
      )}
      <div className={cn('absolute inset-x-[6%] bottom-[5%] flex flex-col gap-1', centered ? 'items-center text-center' : 'items-start text-left')}>
        <span className="h-0.5 w-6 rounded" style={{ background: theme.accent }} />
        <span className="line-clamp-3 text-xs font-bold leading-snug" style={{ color: theme.text }}>{headline}</span>
        {infoLines.length > 0 && (
          <span className="line-clamp-2 text-[9px] leading-snug" style={{ color: theme.sub }}>{infoLines.join(' · ')}</span>
        )}
        {details.cta.trim() && (
          <span className="mt-1 rounded-full px-2.5 py-1 text-[9px] font-bold" style={{ background: theme.accent, color: theme.onAccent }}>
            {details.cta.trim()}
          </span>
        )}
      </div>
    </div>
  );
};

type ToolType = 'poster' | 'visual';
type ImageAspectRatio = '16:9' | '9:16' | '1:1';

const IMAGE_ASPECT_RATIOS: { id: ImageAspectRatio; label: string; description: string }[] = [
  { id: '16:9', label: '16:9', description: 'Landscape' },
  { id: '9:16', label: '9:16', description: 'Story' },
  { id: '1:1', label: '1:1', description: 'Square' },
];

const normalizeImageAspectRatio = (value: unknown, fallback: ImageAspectRatio): ImageAspectRatio =>
  value === '16:9' || value === '9:16' || value === '1:1' ? value : fallback;

interface PosterDetails {
  brand: string;
  headline: string;
  cta: string;
  style: string;
  layout: PosterLayout;
  theme: string;
  offer: string;
  info: string;
}

const POSTER_LAYOUTS: { id: PosterLayout; en: string; km: string; hintEn: string; hintKm: string }[] = [
  { id: 'product', en: 'Product hero', km: 'ផលិតផលជាតួឯក', hintEn: 'Food, drink & products', hintKm: 'ម្ហូប ភេសជ្ជៈ ផលិតផល' },
  { id: 'bold', en: 'Bold event', km: 'ព្រឹត្តិការណ៍ដិតធំ', hintEn: 'Giant title on full photo', hintKm: 'ចំណងជើងធំលើរូបពេញ' },
  { id: 'corporate', en: 'Business', km: 'អាជីវកម្ម', hintEn: 'Slanted panel + info list', hintKm: 'ផ្ទាំងទ្រេត + ព័ត៌មាន' },
  { id: 'card', en: 'Classic card', km: 'កាតបុរាណ', hintEn: 'Framed photo, text below', hintKm: 'រូបមានស៊ុម អក្សរខាងក្រោម' },
  { id: 'band', en: 'Color band', km: 'ឆ្នូតពណ៌', hintEn: 'Big photo, centered text', hintKm: 'រូបធំ អក្សរកណ្ដាល' },
  { id: 'fullbleed', en: 'Full photo', km: 'រូបពេញ', hintEn: 'Text over the photo', hintKm: 'អក្សរលើរូប' },
];

const isPosterLayout = (value: unknown): value is PosterLayout => (
  value === 'product' || value === 'bold' || value === 'corporate' || value === 'card' || value === 'band' || value === 'fullbleed'
);

// Tells the image model where to put the subject so the layout's title and
// panels don't cover a face or product.
const POSTER_COMPOSITION: Record<PosterLayout, string> = {
  product: 'Poster composition: the product is the single hero, large and centered in the lower-middle of the frame, with the top third kept calm and uncluttered (sky, mist, soft light or plain background) for a big title added later.',
  bold: 'Poster composition: place the main subject in the lower-middle two-thirds of the frame, facing the camera with a confident, energetic pose, and keep the top third clean and slightly darker for a big title added later. Dynamic editorial lighting with strong color.',
  corporate: 'Poster composition: place the main subject in the upper half of the frame (face and key product within the top 55%) against a simple, uncluttered background; the bottom part will be covered by a design panel.',
  card: 'Keep the important subject within the central 80% so the app can crop it into a smaller rounded photo frame.',
  band: 'Keep the important subject in the upper-middle of the frame; the bottom third will be covered by a color band.',
  fullbleed: 'Keep the important subject in the upper two-thirds of the frame; the bottom third will fade into a text area.',
};

interface PosterGenerationOptions {
  prompt?: string;
  details?: Partial<PosterDetails>;
  aspectRatio?: string;
}

// Style values come from PromptBuilder's Style chips.
// "Futuristic tech" deliberately drops the real-photo rules: glowing holograms,
// neon light and high-tech offices, like ChatGPT-style AI marketing visuals.
const isFuturisticStyle = (style: string) => style === 'Futuristic tech';
// Default "Cinematic ad" look: big-brand product key visuals (product on a
// natural podium in a dramatic landscape, splashes, cinematic light).
const isKeyVisualStyle = (style: string) => style === 'Cinematic key visual';
const KEY_VISUAL_DIRECTION = 'Cinematic, award-winning commercial key visual like a global brand campaign: the product or subject is the large, perfectly lit hero, standing on a natural podium (mossy rock, wooden slice, stone) or emerging from a dreamy landscape that matches its ingredients (jungle, misty mountains, waterfalls, plantations, sunlit clouds), with splashes, droplets and floating ingredients frozen in motion, golden sun rays, volumetric mist, rim light and rich, deep color grading. Photorealistic high-budget look.';
const FUTURISTIC_DIRECTION = 'Futuristic high-tech AI marketing visual: a modern glass office or tech space with a city skyline at dusk through large windows, glowing blue and cyan holographic dashboards, floating transparent data screens, charts and circuit-line graphics, a glowing interactive glass table, dramatic teal-and-orange cinematic lighting with neon accents, polished and vibrant, high-end tech advertising look. Real-looking people (photorealistic faces and hands) interacting with the holograms.';

interface PosterGenProps {
  automationRequest?: CreativeAutomationRequest | null;
  onAutomationConsumed?: (requestId: string) => void;
  onScheduleHandoff?: (request: ScheduleHandoffRequest) => void;
}

const PosterGen: React.FC<PosterGenProps> = ({ automationRequest, onAutomationConsumed, onScheduleHandoff }) => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const { notify, ToastHost } = useToast();
  const [activeTool, setActiveTool] = useState<ToolType>('poster');
  const [posterPrompt, setPosterPrompt] = useState('A glass of iced coffee on a wooden table in a small Phnom Penh cafe, morning light from the window');
  const [visualPrompt, setVisualPrompt] = useState('A young Cambodian woman smiling while holding our product at a local market');
  const [posterAspectRatio, setPosterAspectRatio] = useState<ImageAspectRatio>('9:16');
  const [visualAspectRatio, setVisualAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [visualStyle, setVisualStyle] = useState('Cinematic key visual');
  const [posterDetails, setPosterDetails] = useState<PosterDetails>({
    // Headline/CTA start empty: a fixed default ("Premium AI Marketing")
    // ended up on unrelated posters (e.g. a noodle-soup photo) when users
    // didn't notice it.
    brand: 'aime.angkorgate',
    headline: '',
    cta: '',
    style: 'Cinematic key visual',
    layout: 'product',
    theme: 'navy',
    offer: '',
    info: '',
  });
  const [loading, setLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isPostingTikTok, setIsPostingTikTok] = useState(false);
  const [tiktokUser, setTiktokUser] = useState<any>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const [isGeneratingScheduleCaption, setIsGeneratingScheduleCaption] = useState(false);
  const handledAutomationRef = React.useRef<string | null>(null);
  const profileVersionRef = useRef(0);

  React.useEffect(() => {
    const clearPreviousProfileImage = () => {
      profileVersionRef.current += 1;
      setGeneratedImage(null);
      setLoading(false);
    };
    window.addEventListener('business-profile-updated', clearPreviousProfileImage);
    return () => window.removeEventListener('business-profile-updated', clearPreviousProfileImage);
  }, []);

  const imageHistory = useGenerationHistory(user, isDemoMode, 'image');
  const persistImageHistory = async (imageDataUrl: string, title: string, payload: Record<string, unknown>) => {
    try {
      const uploadResponse = await fetchImageGenerate({ action: 'uploadMedia', mediaDataUrl: imageDataUrl, mediaType: 'photo' });
      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok || !uploadData.mediaUrl) return;
      await saveGenerationHistory({
        user, isDemoMode, type: 'image',
        title: title.slice(0, 200),
        mediaUrl: uploadData.mediaUrl,
        mediaType: 'photo',
        payload,
      });
    } catch (historyError) {
      console.error('Failed to save image history:', historyError);
    }
  };
  // Merges in only the string fields an older/incomplete saved entry actually
  // has, keeping the current defaults for anything missing -- an entry saved
  // by an earlier version of this schema shouldn't be able to leave e.g.
  // posterDetails.headline undefined, which would throw on the next generate
  // (posterDetails.headline.trim()) and silently break restoring that entry.
  const restoreImageHistory = (entry: GenerationHistoryEntry) => {
    const payload = (entry.payload || {}) as Record<string, unknown>;
    if (payload.tool === 'poster') {
      setActiveTool('poster');
      if (typeof payload.posterPrompt === 'string') setPosterPrompt(payload.posterPrompt);
      const details = (payload.posterDetails && typeof payload.posterDetails === 'object')
        ? payload.posterDetails as Record<string, unknown>
        : {};
      setPosterDetails((prev) => ({
        brand: typeof details.brand === 'string' ? details.brand : prev.brand,
        headline: typeof details.headline === 'string' ? details.headline : prev.headline,
        cta: typeof details.cta === 'string' ? details.cta : prev.cta,
        style: typeof details.style === 'string' ? details.style : prev.style,
        layout: isPosterLayout(details.layout) ? details.layout : prev.layout,
        theme: typeof details.theme === 'string' ? details.theme : prev.theme,
        offer: typeof details.offer === 'string' ? details.offer : '',
        info: typeof details.info === 'string' ? details.info : '',
      }));
      setPosterAspectRatio(normalizeImageAspectRatio(payload.aspectRatio, '9:16'));
    } else {
      setActiveTool('visual');
      if (typeof payload.visualPrompt === 'string') setVisualPrompt(payload.visualPrompt);
      if (typeof payload.visualStyle === 'string') setVisualStyle(payload.visualStyle);
      setVisualAspectRatio(normalizeImageAspectRatio(payload.aspectRatio, '1:1'));
    }
    if (entry.mediaUrl) setGeneratedImage(entry.mediaUrl);
  };
  const deleteImageHistory = (id: string) => { void deleteGenerationHistory({ user, isDemoMode, type: 'image', id }); };

  // PosterGen stays mounted for the app's entire lifetime once it's first
  // rendered (see App.tsx -- it's kept alive via CSS visibility across tab
  // switches so a background generation never gets silently killed by an
  // unmount). A logo loaded once into a ref/state at mount time would then go
  // stale for the rest of the session the moment the user saves a *new* logo
  // in Business Profile afterward -- every later generation, including ones
  // fired straight from AI Agent auto-create, would keep watermarking with
  // the old (often empty) value with no way to notice the profile changed.
  // Fetching fresh right before each watermark call instead guarantees it's
  // always the logo actually saved *now*, at the small, one-time cost of a
  // Firestore read that's negligible next to the multi-second AI image call
  // it follows.
  React.useEffect(() => {
    let cancelled = false;
    let requestId = 0;
    const loadBrand = () => {
      const currentRequest = ++requestId;
      void getLatestBusinessBranding(user, isDemoMode).then((branding) => {
        if (cancelled || currentRequest !== requestId) return;
        setPosterDetails((current) => ({ ...current, brand: branding.businessName }));
      });
    };
    loadBrand();
    window.addEventListener('business-profile-updated', loadBrand);
    return () => { cancelled = true; window.removeEventListener('business-profile-updated', loadBrand); };
  }, [user, isDemoMode]);

  React.useEffect(() => {
    let cancelled = false;
    setTiktokUser(null);
    const refreshTikTokUser = async () => {
      if (!user) return;
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/tiktok/me', { headers: { Authorization: `Bearer ${idToken}` } });
        const data = await response.json();
        if (!cancelled) setTiktokUser(response.ok && !data.error ? data : null);
      } catch (error) {
        if (!cancelled) setTiktokUser(null);
      }
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
        setIsAuthenticating(false);
        void refreshTikTokUser();
      }
    };
    window.addEventListener('message', handleMessage);
    void refreshTikTokUser();

    return () => { cancelled = true; window.removeEventListener('message', handleMessage); };
  }, [user?.uid]);

  const handleTikTokAuth = async () => {
    if (isAuthenticating) {
      setIsAuthenticating(false);
      return;
    }
    const popup = window.open('about:blank', 'tiktokAuth', 'width=600,height=700');
    if (!popup) {
      notify(t('allowPopups'), 'error');
      return;
    }
    
    setIsAuthenticating(true);
    const timeout = setTimeout(() => setIsAuthenticating(false), 10000);

    try {
      if (!user) throw new Error('Sign in to connect TikTok.');
      const res = await fetch('/api/auth/tiktok', { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      const data = await res.json();
      if (data.url) {
        popup.location.href = data.url;
      } else {
        popup.close();
        notify("Failed to get auth URL", 'error');
        clearTimeout(timeout);
        setIsAuthenticating(false);
      }
    } catch (err) {
      popup.close();
      console.error("Auth error", err);
      notify(t('authError'), 'error');
      clearTimeout(timeout);
      setIsAuthenticating(false);
    }
  };

  const handlePostToTikTokPhoto = async () => {
    if (!generatedImage) return;
    setIsPostingTikTok(true);
    try {
      const title = `${posterDetails.headline} — ${posterDetails.cta}`.slice(0, 90);
      const idToken = user ? await user.getIdToken().catch(() => null) : null;
      const res = await fetch('/api/tiktok/publish-photo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ imageDataUrl: generatedImage, title }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || t('postedToTiktok'), 'success');
      } else {
        throw new Error(data.error?.message || 'Publishing failed');
      }
    } catch (error: any) {
      notify(`${t('postFailed')}: ${error.message}\n\nMake sure Vercel has TIKTOK_SCOPES with video.upload/video.publish, then reconnect TikTok so the new permission is included in the access token.`, 'error');
    } finally {
      setIsPostingTikTok(false);
    }
  };

  const handleGeneratePoster = async (options: PosterGenerationOptions = {}) => {
    // Without this, a manual click while an automation-triggered generation (or
    // another manual click) is still in flight starts a second concurrent
    // request; whichever resolves last silently wins setGeneratedImage, with no
    // indication the other request was superseded.
    if (loading) return;
    // A poster without a headline is just a photo. The builder's
    // "Prompt + create" button bypasses the main button's disabled check, so
    // guard here too (automation requests bring their own details).
    if (!options.details && !posterDetails.headline.trim()) {
      notify(language === 'km'
        ? 'សូមសរសេរចំណងជើង Poster ជាមុនសិន (ផ្នែក ① អក្សរលើ Poster)។'
        : 'Add a poster headline first (section ① Poster text).', 'error');
      return;
    }
    const profileVersion = profileVersionRef.current;
    setLoading(true);
    setGeneratedImage(null);
    try {
      const businessContext = await getLatestBusinessBranding(user, isDemoMode);
      const requestedPrompt = options.prompt?.trim() || posterPrompt.trim();
      const requestedDetails: PosterDetails = { ...posterDetails, ...options.details };
      const effectiveBrand = businessContext.businessName || requestedDetails.brand;
      // Only mention headline/CTA when actually filled in -- sending literal
      // `The main headline is ""` noise for an empty field confuses the prompt.
      // Framed as "creative concept/mood" rather than literal text to render:
      // asking for "clear, readable text" here directly contradicted the
      // NO_FOREIGN_TEXT_CONSTRAINT hard constraint that photorealImagePrompt adds
      // server-side (api/ai.js) -- two opposite instructions in the same final
      // prompt, which is a very plausible reason foreign-script text kept leaking
      // through despite that constraint.
      const headlineNote = requestedDetails.headline.trim() ? ` The creative concept/theme is "${requestedDetails.headline.trim()}".` : '';
      const ctaNote = requestedDetails.cta.trim() ? ` The call-to-action mood is "${requestedDetails.cta.trim()}".` : '';
      const posterFuturistic = isFuturisticStyle(requestedDetails.style);
      const posterKeyVisual = isKeyVisualStyle(requestedDetails.style);
      const fullPrompt = `Create the photographic background for a professionally designed marketing poster for a brand named "${effectiveBrand}".${headlineNote}${ctaNote} Style: ${requestedDetails.style}.
      Visual description: ${requestedPrompt}.
      ${posterKeyVisual
        ? `${KEY_VISUAL_DIRECTION} ${POSTER_COMPOSITION[requestedDetails.layout] || POSTER_COMPOSITION.product} The app adds the headline and call-to-action itself afterwards, so do not draw a poster layout or any text inside the image.`
        : requestedDetails.layout === 'product' && !posterFuturistic
        ? `High-end studio product advertising photograph. ${POSTER_COMPOSITION.product} Plain, seamless solid ${findPosterTheme(requestedDetails.theme).photoColor} background filling the whole frame. Make the product look irresistible: crisp detail, appetizing texture, dynamic fresh ingredients, splashes or ice flying around it where it fits the product, soft studio shadow under it, punchy commercial color. If a person is mentioned, keep them small or at the side so the product stays the hero. The app adds the headline and call-to-action itself afterwards, so do not draw any text, logos or labels.`
        : posterFuturistic
        ? `${FUTURISTIC_DIRECTION} ${POSTER_COMPOSITION[requestedDetails.layout] || POSTER_COMPOSITION.bold} The app adds the headline and call-to-action itself afterwards, so do not draw a poster layout or any text inside the image.`
        : `Compose a striking, believable real-camera photograph with one clear, relevant focal subject, as if a skilled advertising photographer shot it on location. ${POSTER_COMPOSITION[requestedDetails.layout] || POSTER_COMPOSITION.bold} The app adds the headline and call-to-action itself afterwards, so do not draw a poster layout or any text inside the image. Use a real lived-in setting, natural light, true-to-life colors, realistic surfaces with small natural imperfections, and real people with natural skin texture; avoid CGI, glossy over-retouched "AI look", glowing HDR, neon, futuristic or fantasy elements, and generic posed stock-photo models unless specifically requested.`}

      CRITICAL INSTRUCTION:
      - The current UI language is: ${language === 'km' ? 'Khmer' : 'English'}.
      - If the UI language is Khmer, ensure the visual style and mood reflect a Cambodian/Khmer aesthetic.
      - If the brand/headline/visual description is in Khmer, prioritize the Khmer aesthetic.
      - Do NOT render the brand name, headline, or call-to-action as literal on-image text -- treat them only as creative direction for the mood, subject, and styling of the photo.`;

      const aspectRatio = normalizeImageAspectRatio(options.aspectRatio, posterAspectRatio);
      const posterLook = posterFuturistic ? 'futuristic'
        : posterKeyVisual ? 'keyvisual'
          : requestedDetails.layout === 'product' ? 'studio' : 'photo';
      const response = await fetchImageGenerate({ action: 'imageGenerate', prompt: fullPrompt, aspectRatio, look: posterLook });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed.');
      const posterImage = await overlayPosterText(data.imageUrl, requestedDetails.headline, requestedDetails.cta, {
        layout: requestedDetails.layout,
        themeId: requestedDetails.theme,
        offer: requestedDetails.offer,
        info: requestedDetails.info,
        brand: effectiveBrand,
      });
      const finalImage = await applyLogoWatermark(posterImage, businessContext.logoDataUrl);
      if (profileVersion !== profileVersionRef.current) return;
      setGeneratedImage(finalImage);
      void persistImageHistory(finalImage, requestedDetails.headline || requestedPrompt, {
        tool: 'poster',
        posterPrompt: requestedPrompt,
        posterDetails: { ...requestedDetails, brand: effectiveBrand },
        aspectRatio,
      });
    } catch (error: any) {
      if (profileVersion !== profileVersionRef.current) return;
      console.error(error);
      if (error?.name === 'AbortError') {
        notify(
          language === 'km'
            ? 'ការបង្កើតរូបភាពចំណាយពេលយូរពេក។ សូមសាកល្បងម្ដងទៀត។'
            : 'Image generation took too long. Please try again.',
          'error',
        );
        return;
      }
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) {
        setNeedsApiKey(true);
      }
      notify(t('errorGeneratingPoster'), 'error');
    } finally {
      if (profileVersion === profileVersionRef.current) setLoading(false);
    }
  };

  const handleGenerateImage = async (promptOverride?: string, aspectRatioOverride?: string) => {
    if (loading) return;
    const profileVersion = profileVersionRef.current;
    const prompt = typeof promptOverride === 'string' ? promptOverride.trim() : visualPrompt.trim();
    const aspectRatio = normalizeImageAspectRatio(aspectRatioOverride, visualAspectRatio);
    if (!prompt) return;
    setLoading(true);
    setGeneratedImage(null);
    try {
      const businessContext = await getLatestBusinessBranding(user, isDemoMode);
      const visualFuturistic = isFuturisticStyle(visualStyle);
      const visualKeyVisual = isKeyVisualStyle(visualStyle);
      const styleDirection = visualFuturistic ? FUTURISTIC_DIRECTION : visualKeyVisual ? KEY_VISUAL_DIRECTION : `${visualStyle} visual style. It must look like a genuine photo taken with a real camera or a good phone in a real place: natural light, true-to-life colors, real skin texture and natural expressions when people are present, small everyday imperfections, and a lived-in background. Avoid the glossy, over-smooth, over-saturated "AI/digital" look, glowing HDR, and 3D-render feel.`;
      const brandedPrompt = `${prompt}\n${styleDirection}${businessContext.businessName
        ? `\nThis visual is for ${businessContext.businessName}; do not render the name as generated text because the saved logo is applied afterward.`
        : ''}`;
      const response = await fetchImageGenerate({ action: 'imageGenerate', prompt: brandedPrompt, aspectRatio, look: visualFuturistic ? 'futuristic' : visualKeyVisual ? 'keyvisual' : 'photo' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed.');
      const finalImage = await applyLogoWatermark(data.imageUrl, businessContext.logoDataUrl);
      if (profileVersion !== profileVersionRef.current) return;
      setGeneratedImage(finalImage);
      void persistImageHistory(finalImage, prompt, { tool: 'visual', visualPrompt: prompt, visualStyle, aspectRatio });
    } catch (error: any) {
      if (profileVersion !== profileVersionRef.current) return;
      console.error(error);
      if (error?.name === 'AbortError') {
        notify(
          language === 'km'
            ? 'ការបង្កើតរូបភាពចំណាយពេលយូរពេក។ សូមសាកល្បងម្ដងទៀត។'
            : 'Image generation took too long. Please try again.',
          'error',
        );
        return;
      }
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) {
        setNeedsApiKey(true);
      }
      notify(t('errorGeneratingPoster'), 'error');
    } finally {
      if (profileVersion === profileVersionRef.current) setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!automationRequest || automationRequest.kind !== 'image') return;
    if (handledAutomationRef.current === automationRequest.id) return;

    handledAutomationRef.current = automationRequest.id;
    const isPosterRequest = automationRequest.imageMode === 'poster';
    setActiveTool(isPosterRequest ? 'poster' : 'visual');
    if (isPosterRequest) {
      const automatedDetails: Partial<PosterDetails> = {
        headline: automationRequest.headline?.trim() || (language === 'km' ? 'បង្កើតអនាគតជាមួយគ្នា' : 'Build What Comes Next'),
        cta: automationRequest.cta?.trim() || (language === 'km' ? 'ស្វែងយល់បន្ថែម' : 'Learn More'),
        // The agent's posterStyle ("Modern", "Bold"...) isn't one of the
        // poster tool's looks; agent posters use the cinematic default.
        style: 'Cinematic key visual',
      };
      setPosterPrompt(automationRequest.prompt);
      setPosterAspectRatio(normalizeImageAspectRatio(automationRequest.aspectRatio, '9:16'));
      setPosterDetails((current) => ({ ...current, ...automatedDetails }));
      setAutomationNotice(
        language === 'km'
          ? `Agent បានរៀបចំ Poster សម្រាប់ ${automationRequest.platform} ហើយកំពុងបង្កើត headline និង CTA លើផ្ទាំងផ្សព្វផ្សាយ។`
          : `The agent prepared a ${automationRequest.platform} poster with a headline and CTA.`,
      );
      onAutomationConsumed?.(automationRequest.id);
      void handleGeneratePoster({
        prompt: automationRequest.prompt,
        details: automatedDetails,
        aspectRatio: automationRequest.aspectRatio,
      });
      return;
    }

    setVisualPrompt(automationRequest.prompt);
    setVisualAspectRatio(normalizeImageAspectRatio(automationRequest.aspectRatio, '1:1'));
    setAutomationNotice(
      language === 'km'
        ? `Agent បានរៀប prompt សម្រាប់ ${automationRequest.platform} ហើយកំពុងបង្កើតរូបភាពស្វ័យប្រវត្តិ។`
        : `The agent prepared a ${automationRequest.platform} brief and started automatic image creation.`,
    );
    onAutomationConsumed?.(automationRequest.id);
    void handleGenerateImage(automationRequest.prompt, automationRequest.aspectRatio);
  }, [automationRequest?.id]);


  const handleDownload = () => {
    if (generatedImage) {
      const link = document.createElement('a');
      link.href = generatedImage;
      link.download = `idea2sale-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleScheduleThisImage = async () => {
    if (!generatedImage) return;
    // Telegram (and most platforms) reject captions over ~1024 characters, and the raw
    // generation prompt can easily run to several times that — cap it so scheduling
    // never silently fails.
    let caption = activeTool === 'poster'
      ? `${posterDetails.headline} — ${posterDetails.cta}`.slice(0, 90)
      : visualPrompt.trim().slice(0, 900);

    // The 'visual' tool has no caption of its own -- without this, the raw English
    // image-generation prompt (e.g. "Create a highly realistic full-body portrait
    // of...") went out as the post caption, which reads as an unfinished AI prompt
    // rather than real marketing copy. Best-effort only: any failure here just
    // keeps the raw-prompt fallback above rather than blocking scheduling.
    if (activeTool === 'visual') {
      setIsGeneratingScheduleCaption(true);
      try {
        const businessContext = await getLatestBusinessBranding(user, isDemoMode);
        const response = await fetchImageGenerate({ action: 'videoCaption', prompt: visualPrompt, language, businessContext });
        const data = await response.json();
        if (response.ok && typeof data?.text === 'string' && data.text.trim()) {
          caption = data.text.trim().slice(0, 900);
        }
      } catch (error) {
        console.error('Caption generation for scheduling failed, using the raw prompt instead:', error);
      } finally {
        setIsGeneratingScheduleCaption(false);
      }
    }

    onScheduleHandoff?.({
      id: `${Date.now()}-image`,
      kind: 'image',
      mediaDataUrl: generatedImage,
      mediaName: `idea2sale-image-${Date.now()}.png`,
      caption,
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <ToastHost />
      {automationNotice && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">
          <Sparkles size={18} className="shrink-0" />
          <span>{automationNotice}</span>
        </div>
      )}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3 dark:text-brand-400">
            {t('posterGenTitle')}
            <ImageIcon className="text-brand-500" size={32} />
          </h2>
          <p className="text-slate-500 mt-1 text-lg dark:text-slate-400">{t('posterGenSubtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex bg-brand-100/50 p-1.5 rounded-2xl border border-brand-200 backdrop-blur-sm">
            {[
              { id: 'poster', label: t('posterMaker'), icon: ImageIcon },
              { id: 'visual', label: t('imageGen'), icon: Sparkles },
            ].map((tool) => (
              <button 
                key={tool.id}
                onClick={() => setActiveTool(tool.id as ToolType)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 whitespace-nowrap",
                  activeTool === tool.id
                    ? "bg-white text-brand-700 shadow-md scale-105 dark:bg-slate-800 dark:text-brand-400"
                    : "text-brand-500 hover:text-brand-800"
                )}
              >
                <tool.icon size={18} />
                {tool.label}
              </button>
            ))}
          </div>
          <button 
            onClick={handleTikTokAuth}
            disabled={isAuthenticating}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-slate-900 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
              isAuthenticating && "animate-pulse"
            )}
          >
            {isAuthenticating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
              </svg>
            )}
            {tiktokUser ? `Connected: ${tiktokUser.display_name}` : (isAuthenticating ? t('connecting') : t('connectTiktok'))}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5 space-y-8">
          <div className="glass p-8 rounded-[2.5rem] space-y-6 relative overflow-hidden">
            {activeTool === 'poster' ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-brand-100 bg-brand-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                  <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
                    {language === 'km' ? 'រចនា Poster ក្នុង ៣ ជំហាន' : 'Design a poster in 3 steps'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {language === 'km'
                      ? '① សរសេរអក្សរលើ Poster → ② ជ្រើសប្លង់ និងពណ៌ → ③ ជ្រើសរូបថត ហើយចុចបង្កើត។'
                      : '① Type the poster text → ② pick a layout and colors → ③ choose the photo and create.'}
                  </p>
                </div>

                {/* ① Poster text */}
                <section className="space-y-4 rounded-2xl border border-brand-200 bg-white/60 p-4 dark:border-slate-600 dark:bg-slate-900/40">
                  <p className="text-base font-bold text-brand-700 dark:text-brand-300">
                    {language === 'km' ? '① អក្សរលើ Poster' : '① Poster text'}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('brandName')}</span>
                      <input
                        type="text"
                        value={posterDetails.brand}
                        onChange={(e) => setPosterDetails({ ...posterDetails, brand: e.target.value })}
                        placeholder="e.g., Brown Coffee"
                        className={posterInputClass}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('callToAction')}</span>
                      <input
                        type="text"
                        value={posterDetails.cta}
                        onChange={(e) => setPosterDetails({ ...posterDetails, cta: e.target.value })}
                        placeholder={language === 'km' ? 'ឧ. កុម្ម៉ង់ឥឡូវ' : 'e.g., Order Now'}
                        className={posterInputClass}
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('mainHeadline')}</span>
                    <input
                      type="text"
                      value={posterDetails.headline}
                      onChange={(e) => setPosterDetails({ ...posterDetails, headline: e.target.value })}
                      placeholder={language === 'km' ? 'ឧ. កាហ្វេឆ្ងាញ់បំផុតក្នុងក្រុង' : 'e.g., Best Coffee in Town'}
                      className={posterInputClass}
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                        {language === 'km' ? 'ស្លាកប្រូម៉ូសិន (មិនចាំបាច់)' : 'Offer badge (optional)'}
                      </span>
                      <input
                        type="text"
                        value={posterDetails.offer}
                        maxLength={24}
                        onChange={(e) => setPosterDetails({ ...posterDetails, offer: e.target.value })}
                        placeholder={language === 'km' ? 'ឧ. បញ្ចុះ 30%' : 'e.g., -30% OFF'}
                        className={posterInputClass}
                      />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                        {language === 'km' ? 'ព័ត៌មាន (មួយបន្ទាត់មួយ, មិនចាំបាច់)' : 'Details (one per line, optional)'}
                      </span>
                      <textarea
                        value={posterDetails.info}
                        maxLength={200}
                        rows={3}
                        onChange={(e) => setPosterDetails({ ...posterDetails, info: e.target.value })}
                        placeholder={language === 'km'
                          ? 'ឧ.\nថ្ងៃសៅរ៍ ២៨ សីហា\nម៉ោង ៧ យប់\nផ្សារធំថ្មី ភ្នំពេញ'
                          : 'e.g.\nSaturday, Aug 28\nDoors open 7 PM\nCentral Market, Phnom Penh'}
                        className={cn(posterInputClass, 'resize-none leading-6')}
                      />
                    </label>
                  </div>
                </section>

                {/* ② Poster design */}
                <section className="space-y-4 rounded-2xl border border-brand-200 bg-white/60 p-4 dark:border-slate-600 dark:bg-slate-900/40">
                  <p className="text-base font-bold text-brand-700 dark:text-brand-300">
                    {language === 'km' ? '② ប្លង់ និងពណ៌' : '② Layout & colors'}
                  </p>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{language === 'km' ? 'ប្លង់' : 'Layout'}</p>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={language === 'km' ? 'ប្លង់' : 'Layout'}>
                      {POSTER_LAYOUTS.map((layout) => {
                        const selected = posterDetails.layout === layout.id;
                        return (
                          <button
                            key={layout.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setPosterDetails((prev) => ({ ...prev, layout: layout.id }))}
                            className={cn(
                              'rounded-xl border p-2 text-center transition-all',
                              selected
                                ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500'
                                : 'border-brand-200 bg-brand-50 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800',
                            )}
                          >
                            <LayoutThumb layout={layout.id} />
                            <span className={cn('mt-1.5 block text-xs font-semibold', selected ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200')}>
                              {language === 'km' ? layout.km : layout.en}
                            </span>
                            <span className="block text-[10px] text-slate-400">{language === 'km' ? layout.hintKm : layout.hintEn}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{language === 'km' ? 'ពណ៌ Poster' : 'Color theme'}</p>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={language === 'km' ? 'ពណ៌ Poster' : 'Color theme'}>
                      {POSTER_THEMES.map((theme) => {
                        const selected = posterDetails.theme === theme.id;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => setPosterDetails((prev) => ({ ...prev, theme: theme.id }))}
                            className={cn(
                              'flex min-h-[44px] items-center gap-2 rounded-xl border px-2 py-2 text-left transition-all',
                              selected
                                ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500'
                                : 'border-brand-200 bg-brand-50 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800',
                            )}
                          >
                            <span className="flex shrink-0 overflow-hidden rounded-full border border-black/10" aria-hidden="true">
                              <span className="h-5 w-3" style={{ background: theme.bg }} />
                              <span className="h-5 w-3" style={{ background: theme.accent }} />
                            </span>
                            <span className={cn('text-[11px] font-semibold leading-tight', selected ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200')}>
                              {language === 'km' ? theme.km : theme.en}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {language === 'km' ? 'ទំហំ Poster' : 'Poster size'}
                  </p>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Poster aspect ratio">
                    {IMAGE_ASPECT_RATIOS.map((ratio) => (
                      <button
                        key={ratio.id}
                        type="button"
                        onClick={() => setPosterAspectRatio(ratio.id)}
                        aria-pressed={posterAspectRatio === ratio.id}
                        className={cn(
                          'rounded-xl border px-2 py-3 text-center transition-all',
                          posterAspectRatio === ratio.id
                            ? 'border-brand-500 bg-brand-600 text-white shadow-md'
                            : 'border-brand-200 bg-brand-50 text-brand-600 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
                        )}
                      >
                        <span className="block text-sm font-black">{ratio.label}</span>
                        <span className={cn('mt-0.5 block text-[10px] font-semibold', posterAspectRatio === ratio.id ? 'text-white/75' : 'text-slate-400')}>
                          {ratio.description}
                        </span>
                      </button>
                    ))}
                  </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {language === 'km' ? 'មើលជាមុន' : 'Preview'}
                    </p>
                    <PosterPreview details={posterDetails} aspectRatio={posterAspectRatio} km={language === 'km'} />
                  </div>
                </section>

                {/* ③ Poster photo */}
                <PromptBuilder
                  compact
                  mode="poster"
                  language={language}
                  onPromptChange={setPosterPrompt}
                  look={posterDetails.style}
                  onLookChange={(style) => setPosterDetails((prev) => ({ ...prev, style }))}
                  onGenerate={(prompt) => void handleGeneratePoster({ prompt })}
                  busy={loading}
                />
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                    {language === 'km' ? 'Prompt របស់អ្នក (អាចកែបាន)' : 'Your prompt (you can edit it)'}
                  </label>
                  <textarea
                    value={posterPrompt}
                    onChange={(e) => setPosterPrompt(e.target.value)}
                    placeholder={language === 'km' ? 'ចុច «បង្កើត Prompt» ខាងលើ ឬសរសេរដោយខ្លួនឯង' : 'Press “Create prompt” above, or write your own'}
                    className="w-full h-44 p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm leading-6 focus:ring-2 focus:ring-brand-500 outline-none transition-all resize-y dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl border border-brand-100 bg-brand-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/70">
                  <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
                    {language === 'km' ? 'បង្កើតរូបភាពក្នុង ៣ ជំហាន' : 'Create an image in 3 steps'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {language === 'km'
                      ? 'ជ្រើសទំហំ → ចុចជ្រើសជម្រើស → ចុចបង្កើត។ មិនចាំបាច់ចេះសរសេរ prompt ទេ។'
                      : 'Pick a size → tap your choices → press create. No prompt writing skills needed.'}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                    {language === 'km' ? 'ទំហំរូបភាព' : 'Image aspect ratio'}
                  </label>
                  <div className="grid grid-cols-3 gap-2" role="group" aria-label="Image aspect ratio">
                    {IMAGE_ASPECT_RATIOS.map((ratio) => (
                      <button
                        key={ratio.id}
                        type="button"
                        onClick={() => setVisualAspectRatio(ratio.id)}
                        aria-pressed={visualAspectRatio === ratio.id}
                        className={cn(
                          'rounded-xl border px-2 py-3 text-center transition-all',
                          visualAspectRatio === ratio.id
                            ? 'border-brand-500 bg-brand-600 text-white shadow-md'
                            : 'border-brand-200 bg-brand-50 text-brand-600 hover:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
                        )}
                      >
                        <span className="block text-sm font-black">{ratio.label}</span>
                        <span className={cn('mt-0.5 block text-[10px] font-semibold', visualAspectRatio === ratio.id ? 'text-white/75' : 'text-slate-400')}>
                          {ratio.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <PromptBuilder
                  mode="image"
                  language={language}
                  onPromptChange={setVisualPrompt}
                  look={visualStyle}
                  onLookChange={setVisualStyle}
                  onGenerate={(prompt) => void handleGenerateImage(prompt)}
                  busy={loading}
                />
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                    {language === 'km' ? 'Prompt របស់អ្នក (អាចកែបាន)' : 'Your prompt (you can edit it)'}
                  </label>
                  <textarea
                    value={visualPrompt}
                    onChange={(e) => setVisualPrompt(e.target.value)}
                    placeholder={language === 'km' ? 'ចុច «បង្កើត Prompt» ខាងលើ ឬសរសេរដោយខ្លួនឯង' : 'Press “Create prompt” above, or write your own'}
                    className="w-full h-44 p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm leading-6 focus:ring-2 focus:ring-brand-500 outline-none transition-all resize-y dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>
            )}
            
            <button
              onClick={() => {
                if (activeTool === 'poster') {
                  void handleGeneratePoster();
                } else {
                  void handleGenerateImage();
                }
              }}
              disabled={loading || (activeTool === 'visual'
                ? !visualPrompt.trim()
                : !posterDetails.headline.trim() || !posterPrompt.trim())}
              className="w-full bg-gradient-to-r from-[#f88b3e] to-[#e65d28] hover:from-[#ee7d33] hover:to-[#d94f1f] text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-orange-500/20"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Sparkles size={22} />}
              <span className="text-lg">{loading ? t('generatingMagic') : t('generateWithAi')}</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="glass p-8 rounded-[2.5rem] min-h-[600px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2 dark:text-brand-400">
                <div className="w-2 h-6 bg-brand-500 rounded-full" />
                {t('aiGenerationResult')}
              </h3>
              {generatedImage && (
                <motion.button
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.94 }}
                  onClick={handleDownload}
                  className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200"
                >
                  <Download size={20} />
                </motion.button>
              )}
            </div>

            <div className="flex-1 flex flex-col">
              {!generatedImage && !loading && (
                <div className="flex-1 flex flex-col items-center justify-center text-brand-300 space-y-6">
                  <div className="w-24 h-24 bg-brand-50 rounded-[2rem] flex items-center justify-center border border-brand-100 shadow-inner">
                    <ImageIcon size={40} className="text-brand-200" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-medium text-brand-500">{t('readyToCreate')}</p>
                    <p className="text-sm">{t('imageWillAppear')}</p>
                  </div>
                </div>
              )}

              {loading && (
                <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin" />
                    <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-brand-600 animate-pulse" size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-brand-700 animate-pulse">{t('craftingMasterpiece')}</p>
                    <p className="text-brand-500">{t('takesFewSeconds')}</p>
                  </div>
                </div>
              )}

              <AnimatePresence mode="wait">
                {generatedImage && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mx-auto w-fit max-w-full rounded-3xl overflow-hidden shadow-2xl border-8 border-white relative dark:border-slate-700"
                  >
                    {/* Fit the whole poster on screen: a tall 9:16 poster at full
                        width pushed the headline and button below the fold, so it
                        looked like a plain photo. */}
                    <img
                      src={generatedImage}
                      alt="AI Generated"
                      className="block h-auto max-h-[75vh] w-auto max-w-full object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              
              {generatedImage && (
                <div className="mt-6 flex gap-4">
                  {tiktokUser ? (
                    <button
                      onClick={handlePostToTikTokPhoto}
                      disabled={isPostingTikTok}
                      className="flex-1 bg-black text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl hover:bg-slate-900 transition-all disabled:opacity-50"
                    >
                      {isPostingTikTok ? <Loader2 size={20} className="animate-spin" /> : (
                        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                        </svg>
                      )}
                      {t('postToTiktok')} (@{tiktokUser.display_name || tiktokUser.username || tiktokUser.open_id})
                    </button>
                  ) : (
                    <button
                      onClick={handleTikTokAuth}
                      disabled={isAuthenticating}
                      className="flex-1 bg-brand-600 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl hover:bg-brand-700 transition-all disabled:opacity-50"
                    >
                      {isAuthenticating ? <Loader2 size={20} className="animate-spin" /> : (
                        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                        </svg>
                      )}
                      {t('connectTiktok')}
                    </button>
                  )}
                  <button
                    onClick={handleScheduleThisImage}
                    disabled={isGeneratingScheduleCaption}
                    className="p-4 bg-brand-100 text-brand-700 rounded-2xl hover:bg-brand-200 transition-all border border-brand-200 disabled:opacity-50"
                    title="Schedule for later"
                  >
                    {isGeneratingScheduleCaption ? <Loader2 size={24} className="animate-spin" /> : <Calendar size={24} />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <HistoryPanel entries={imageHistory} onRestore={restoreImageHistory} onDelete={deleteImageHistory} />
    </div>
  );
};

export default PosterGen;
