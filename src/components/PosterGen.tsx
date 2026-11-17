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
const CTA_ACCENT_COLOR = '#f97316';
const POSTER_BACKGROUND = '#102235';
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

const overlayPosterText = async (baseDataUrl: string, headline: string, cta: string): Promise<string> => {
  const headlineText = headline.trim();
  const ctaText = cta.trim();
  if (!headlineText && !ctaText) return baseDataUrl;

  try {
    if (typeof document !== 'undefined' && (document as any).fonts?.load) {
      await Promise.all([
        (document as any).fonts.load(`700 48px ${POSTER_TEXT_FONT_FAMILY}`),
        (document as any).fonts.load(`700 24px ${POSTER_TEXT_FONT_FAMILY}`),
        (document as any).fonts.load('700 48px "Inter"'),
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
        const margin = Math.round(base.width * TEXT_MARGIN_RATIO);
        const maxTextWidth = base.width - margin * 2;
        const photoHeight = Math.round(base.height * (base.height > base.width ? 0.62 : 0.54));
        const photoBottom = margin + photoHeight;
        const photoRadius = Math.round(base.width * 0.025);
        ctx.fillStyle = POSTER_BACKGROUND;
        ctx.fillRect(0, 0, base.width, base.height);
        // The actual photo is a smaller, framed visual. Exact copy lives in
        // the separate dark panel instead of obscuring a face or product.
        const scale = Math.max(maxTextWidth / base.width, photoHeight / base.height);
        const sourceWidth = maxTextWidth / scale;
        const sourceHeight = photoHeight / scale;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(margin, margin, maxTextWidth, photoHeight, photoRadius);
        ctx.clip();
        ctx.drawImage(base, (base.width - sourceWidth) / 2, (base.height - sourceHeight) / 2,
          sourceWidth, sourceHeight, margin, margin, maxTextWidth, photoHeight);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const ctaFontSize = Math.max(14, Math.round(base.width * CTA_FONT_SIZE_RATIO));
        const ctaPaddingX = Math.round(base.width * 0.035);
        const ctaPaddingY = Math.round(base.width * 0.018);
        let ctaPillWidth = 0;
        let ctaPillHeight = 0;
        if (ctaText) {
          ctx.font = `700 ${ctaFontSize}px ${posterFontFamily(ctaText)}`;
          ctaPillWidth = Math.min(ctx.measureText(ctaText).width + ctaPaddingX * 2, maxTextWidth);
          ctaPillHeight = ctaFontSize * LINE_HEIGHT_RATIO + ctaPaddingY * 2;
        }
        const pillY = base.height - margin - ctaPillHeight;
        const headlineTop = photoBottom + Math.round(margin * 1.2);
        const headlineRoom = (ctaText ? pillY - margin * 0.55 : base.height - margin) - headlineTop;
        let headlineFontSize = Math.round(base.width * HEADLINE_FONT_SIZE_RATIO);
        let headlineLineHeight = Math.round(headlineFontSize * LINE_HEIGHT_RATIO);
        let headlineLines: string[] = [];
        if (headlineText) {
          for (let size = headlineFontSize; size >= Math.max(14, Math.round(base.width * 0.032)); size -= 2) {
            ctx.font = `700 ${size}px ${posterFontFamily(headlineText)}`;
            const lines = wrapCanvasText(ctx, headlineText, maxTextWidth * 0.86);
            headlineFontSize = size;
            headlineLineHeight = Math.round(size * LINE_HEIGHT_RATIO);
            headlineLines = lines;
            if (lines.length * headlineLineHeight <= headlineRoom) break;
          }
        }
        ctx.fillStyle = CTA_ACCENT_COLOR;
        ctx.fillRect(margin, photoBottom + Math.round(margin * 0.55),
          Math.round(base.width * 0.095), Math.max(3, Math.round(base.width * 0.006)));

        let y = headlineTop;
        if (headlineLines.length) {
          ctx.font = `700 ${headlineFontSize}px ${posterFontFamily(headlineText)}`;
          ctx.fillStyle = '#ffffff';
          for (const line of headlineLines) {
            ctx.fillText(line, margin, y, maxTextWidth * 0.86);
            y += headlineLineHeight;
          }
        }

        if (ctaText) {
          const pillX = margin;
          const radius = ctaPillHeight / 2;
          ctx.fillStyle = CTA_ACCENT_COLOR;
          ctx.beginPath();
          ctx.moveTo(pillX + radius, pillY);
          ctx.arcTo(pillX + ctaPillWidth, pillY, pillX + ctaPillWidth, pillY + ctaPillHeight, radius);
          ctx.arcTo(pillX + ctaPillWidth, pillY + ctaPillHeight, pillX, pillY + ctaPillHeight, radius);
          ctx.arcTo(pillX, pillY + ctaPillHeight, pillX, pillY, radius);
          ctx.arcTo(pillX, pillY, pillX + ctaPillWidth, pillY, radius);
          ctx.closePath();
          ctx.fill();

          ctx.font = `700 ${ctaFontSize}px ${posterFontFamily(ctaText)}`;
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(ctaText, pillX + ctaPillWidth / 2,
            pillY + (ctaPillHeight - ctaFontSize * LINE_HEIGHT_RATIO) / 2,
            ctaPillWidth - ctaPaddingX);
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
}

interface PosterGenerationOptions {
  prompt?: string;
  details?: Partial<PosterDetails>;
  aspectRatio?: string;
}

// Style values come from PromptBuilder's Style chips.
// "Futuristic tech" deliberately drops the real-photo rules: glowing holograms,
// neon light and high-tech offices, like ChatGPT-style AI marketing visuals.
const isFuturisticStyle = (style: string) => style === 'Futuristic tech';
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
  const [visualStyle, setVisualStyle] = useState('Natural real photo');
  const [posterDetails, setPosterDetails] = useState({
    brand: 'aime.angkorgate',
    headline: 'Premium AI Marketing',
    cta: 'Try Now',
    style: 'Natural real photo'
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
      const fullPrompt = `Create the photographic background for a professionally designed marketing poster for a brand named "${effectiveBrand}".${headlineNote}${ctaNote} Style: ${requestedDetails.style}.
      Visual description: ${requestedPrompt}.
      ${posterFuturistic
        ? `${FUTURISTIC_DIRECTION} Keep the important subject within the central 80% so the app can crop it into a smaller rounded photo frame. The app places the headline and call-to-action in a separate panel below the image, so do not draw a poster layout or text inside the image.`
        : 'Compose a believable, everyday real-camera photograph with one clear, relevant focal subject, as if a skilled local photographer shot it on location. Keep the important subject within the central 80% so the app can crop it into a smaller rounded photo frame. The app places the headline and call-to-action in a separate panel below the photo, so do not reserve text space or draw a poster layout inside the image. Use a real lived-in setting, natural light, true-to-life colors, realistic surfaces with small natural imperfections, and real people with natural skin texture; avoid CGI, glossy over-retouched "AI look", glowing HDR, neon, futuristic or fantasy elements, and generic posed stock-photo models unless specifically requested.'}

      CRITICAL INSTRUCTION:
      - The current UI language is: ${language === 'km' ? 'Khmer' : 'English'}.
      - If the UI language is Khmer, ensure the visual style and mood reflect a Cambodian/Khmer aesthetic.
      - If the brand/headline/visual description is in Khmer, prioritize the Khmer aesthetic.
      - Do NOT render the brand name, headline, or call-to-action as literal on-image text -- treat them only as creative direction for the mood, subject, and styling of the photo.`;

      const aspectRatio = normalizeImageAspectRatio(options.aspectRatio, posterAspectRatio);
      const response = await fetchImageGenerate({ action: 'imageGenerate', prompt: fullPrompt, aspectRatio, look: posterFuturistic ? 'futuristic' : 'photo' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed.');
      const posterImage = await overlayPosterText(data.imageUrl, requestedDetails.headline, requestedDetails.cta);
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
      const styleDirection = visualFuturistic ? FUTURISTIC_DIRECTION : `${visualStyle} visual style. It must look like a genuine photo taken with a real camera or a good phone in a real place: natural light, true-to-life colors, real skin texture and natural expressions when people are present, small everyday imperfections, and a lived-in background. Avoid the glossy, over-smooth, over-saturated "AI/digital" look, glowing HDR, and 3D-render feel.`;
      const brandedPrompt = `${prompt}\n${styleDirection}${businessContext.businessName
        ? `\nThis visual is for ${businessContext.businessName}; do not render the name as generated text because the saved logo is applied afterward.`
        : ''}`;
      const response = await fetchImageGenerate({ action: 'imageGenerate', prompt: brandedPrompt, aspectRatio, look: visualFuturistic ? 'futuristic' : 'photo' });
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
        style: automationRequest.posterStyle?.trim() || 'Modern',
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
                    {language === 'km' ? 'បង្កើត Poster ក្នុង ៣ ជំហាន' : 'Create a poster in 3 steps'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {language === 'km'
                      ? 'សរសេរចំណងជើង និងប៊ូតុង → ចុចជ្រើសជម្រើស → ចុចបង្កើត។ មិនចាំបាច់ចេះសរសេរ prompt ទេ។'
                      : 'Type your headline and button text → tap your choices → press create. No prompt writing skills needed.'}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('brandName')}</label>
                  <input
                    type="text"
                    value={posterDetails.brand}
                    onChange={(e) => setPosterDetails({...posterDetails, brand: e.target.value})}
                    placeholder="e.g., Brown Coffee"
                    className="w-full p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('mainHeadline')}</label>
                  <input 
                    type="text" 
                    value={posterDetails.headline}
                    onChange={(e) => setPosterDetails({...posterDetails, headline: e.target.value})}
                    placeholder="e.g., Best Coffee in Town"
                    className="w-full p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('callToAction')}</label>
                  <input 
                    type="text" 
                    value={posterDetails.cta}
                    onChange={(e) => setPosterDetails({...posterDetails, cta: e.target.value})}
                    placeholder="e.g., Order Now"
                    className="w-full p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                    {language === 'km' ? 'ទំហំ Poster' : 'Poster aspect ratio'}
                  </label>
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
                <PromptBuilder
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
                : !posterDetails.brand.trim() || !posterDetails.headline.trim() || !posterDetails.cta.trim() || !posterPrompt.trim())}
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
                    className="rounded-3xl overflow-hidden shadow-2xl border-8 border-white group relative dark:border-slate-700"
                  >
                    <img 
                      src={generatedImage} 
                      alt="AI Generated" 
                      className="w-full h-auto transition-transform duration-700 group-hover:scale-105"
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
