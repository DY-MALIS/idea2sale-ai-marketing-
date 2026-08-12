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
import { motion, AnimatePresence } from 'motion/react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { BusinessProfileData, CreativeAutomationRequest, ScheduleHandoffRequest } from '../types';

const LOGO_MARGIN_RATIO = 0.04;
const LOGO_WIDTH_RATIO = 0.16;

const applyLogoWatermark = (baseDataUrl: string, logoDataUrl: string): Promise<string> => {
  if (!logoDataUrl) return Promise.resolve(baseDataUrl);
  return new Promise((resolve) => {
    const base = new Image();
    base.onload = () => {
      const logo = new Image();
      logo.onload = () => {
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
        const logoWidth = Math.round(base.width * LOGO_WIDTH_RATIO);
        const logoHeight = Math.round(logoWidth * (logo.height / logo.width));
        ctx.drawImage(logo, margin, base.height - logoHeight - margin, logoWidth, logoHeight);
        resolve(canvas.toDataURL('image/png'));
      };
      logo.onerror = () => resolve(baseDataUrl);
      logo.src = logoDataUrl;
    };
    base.onerror = () => resolve(baseDataUrl);
    base.src = baseDataUrl;
  });
};

type ToolType = 'poster' | 'visual';

interface PosterGenProps {
  automationRequest?: CreativeAutomationRequest | null;
  onAutomationConsumed?: (requestId: string) => void;
  onScheduleHandoff?: (request: ScheduleHandoffRequest) => void;
}

const PosterGen: React.FC<PosterGenProps> = ({ automationRequest, onAutomationConsumed, onScheduleHandoff }) => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const { notify, ToastHost } = useToast();
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const logoDataUrlRef = useRef('');
  const [activeTool, setActiveTool] = useState<ToolType>('poster');
  const [posterPrompt, setPosterPrompt] = useState('A real product photo in a Cambodian cafe setting, warm sunlight, premium commercial photography, natural shadows, realistic texture, lifestyle background');
  const [visualPrompt, setVisualPrompt] = useState('A photorealistic product advertisement scene, real camera photo, premium lighting, natural shadows, detailed texture, cinematic depth of field, TikTok-ready composition');
  const [posterDetails, setPosterDetails] = useState({
    brand: 'aime.angkorgate',
    headline: 'Premium AI Marketing',
    cta: 'Try Now',
    style: 'Modern'
  });
  const [loading, setLoading] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isPostingTikTok, setIsPostingTikTok] = useState(false);
  const [tiktokUser, setTiktokUser] = useState<any>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const handledAutomationRef = React.useRef<string | null>(null);

  const updateLogoDataUrl = (value: string) => {
    logoDataUrlRef.current = value;
    setLogoDataUrl(value);
  };

  React.useEffect(() => {
    const loadLogo = async () => {
      try {
        if (isDemoMode || !user) {
          const saved = JSON.parse(localStorage.getItem('demo_business_profile') || 'null');
          updateLogoDataUrl(saved?.logoDataUrl || '');
          return;
        }
        const snap = await getDoc(doc(db, 'business_profiles', user.uid));
        updateLogoDataUrl((snap.data() as BusinessProfileData | undefined)?.logoDataUrl || '');
      } catch {
        updateLogoDataUrl('');
      }
    };
    void loadLogo();
  }, [user, isDemoMode]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
        setIsAuthenticating(false);
        fetch('/api/tiktok/me')
          .then(res => res.json())
          .then(data => setTiktokUser(data))
          .catch(err => console.error("Failed to fetch user after auth", err));
      }
    };
    window.addEventListener('message', handleMessage);
    
    // Initial check
    fetch('/api/tiktok/me')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setTiktokUser(data);
      })
      .catch(() => {});

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleTikTokAuth = async () => {
    if (isAuthenticating) {
      setIsAuthenticating(false);
      return;
    }
    
    setIsAuthenticating(true);
    const timeout = setTimeout(() => setIsAuthenticating(false), 10000);

    try {
      const res = await fetch('/api/auth/tiktok');
      const data = await res.json();
      if (data.url) {
        const width = 600, height = 700;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const popup = window.open(
          data.url, 
          'tiktokAuth', 
          `width=${width},height=${height},top=${top},left=${left}`
        );
        if (!popup) {
          notify(t('allowPopups'), 'error');
          clearTimeout(timeout);
          setIsAuthenticating(false);
        }
      } else {
        notify("Failed to get auth URL", 'error');
        clearTimeout(timeout);
        setIsAuthenticating(false);
      }
    } catch (err) {
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

  const handleGeneratePoster = async () => {
    setLoading(true);
    setGeneratedImage(null);
    try {
      const fullPrompt = `Create a professional marketing poster for a brand named "${posterDetails.brand}". 
      The main headline is "${posterDetails.headline}". 
      The call to action is "${posterDetails.cta}". 
      Style: ${posterDetails.style}. 
      Visual description: ${posterPrompt}. 
      The poster should have clear, readable text for the brand and headline.
      Make the scene look like a real commercial photoshoot with a physical product, real environment, real light, realistic surfaces, and premium camera quality.
      
      CRITICAL INSTRUCTION:
      - The current UI language is: ${language === 'km' ? 'Khmer' : 'English'}.
      - If the UI language is Khmer, ensure the visual style reflects a Cambodian/Khmer aesthetic and any text on the poster is correctly rendered or inspired by Khmer culture.
      - If the brand/headline/visual description is in Khmer, prioritize the Khmer aesthetic.`;

      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'imageGenerate', prompt: fullPrompt, aspectRatio: '3:4' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed.');
      setGeneratedImage(await applyLogoWatermark(data.imageUrl, logoDataUrlRef.current));
    } catch (error: any) {
      console.error(error);
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) {
        setNeedsApiKey(true);
      }
      notify(t('errorGeneratingPoster'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateImage = async (promptOverride?: string, aspectRatioOverride?: string) => {
    const prompt = typeof promptOverride === 'string' ? promptOverride.trim() : visualPrompt.trim();
    const aspectRatio = typeof aspectRatioOverride === 'string' ? aspectRatioOverride : '1:1';
    if (!prompt) return;
    setLoading(true);
    setGeneratedImage(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'imageGenerate', prompt, aspectRatio }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed.');
      setGeneratedImage(await applyLogoWatermark(data.imageUrl, logoDataUrlRef.current));
    } catch (error: any) {
      console.error(error);
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) {
        setNeedsApiKey(true);
      }
      notify(t('errorGeneratingPoster'), 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!automationRequest || automationRequest.kind !== 'image') return;
    if (handledAutomationRef.current === automationRequest.id) return;

    handledAutomationRef.current = automationRequest.id;
    setActiveTool('visual');
    setVisualPrompt(automationRequest.prompt);
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

  const handleScheduleThisImage = () => {
    if (!generatedImage) return;
    // Telegram (and most platforms) reject captions over ~1024 characters, and the raw
    // generation prompt can easily run to several times that — cap it so scheduling
    // never silently fails.
    const caption = activeTool === 'poster'
      ? `${posterDetails.headline} — ${posterDetails.cta}`.slice(0, 90)
      : visualPrompt.trim().slice(0, 900);
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
                <div className="grid grid-cols-2 gap-5">
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
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('style')}</label>
                    <select 
                      value={posterDetails.style}
                      onChange={(e) => setPosterDetails({...posterDetails, style: e.target.value})}
                      className="w-full p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                    >
                      <option>Modern</option>
                      <option>Vintage</option>
                      <option>Minimalist</option>
                      <option>Luxury</option>
                      <option>Cyberpunk</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('mainHeadline')}</label>
                  <input 
                    type="text" 
                    value={posterDetails.headline}
                    onChange={(e) => setPosterDetails({...posterDetails, headline: e.target.value})}
                    placeholder="e.g., Best Coffee in Town"
                    className="w-full p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('callToAction')}</label>
                  <input 
                    type="text" 
                    value={posterDetails.cta}
                    onChange={(e) => setPosterDetails({...posterDetails, cta: e.target.value})}
                    placeholder="e.g., Order Now"
                    className="w-full p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('visualTheme')}</label>
                  <textarea
                    value={posterPrompt}
                    onChange={(e) => setPosterPrompt(e.target.value)}
                    placeholder="Describe the real product, location, lighting, camera angle, and mood..."
                    className="w-full h-28 p-4 rounded-2xl bg-brand-50 border border-brand-200 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all resize-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('visualConcept')}</label>
                <textarea
                  value={visualPrompt}
                  onChange={(e) => setVisualPrompt(e.target.value)}
                  placeholder="Describe a realistic product photo: subject, setting, camera angle, lighting, background..."
                  className="w-full h-56 p-5 rounded-2xl bg-brand-50 border border-brand-200 focus:ring-2 focus:ring-brand-500 outline-none transition-all resize-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                />
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
              disabled={loading || (activeTool === 'visual' && !visualPrompt)}
              className="w-full bg-gradient-to-r from-brand-600 to-crab-shell hover:from-brand-700 hover:to-crab-shell/90 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-brand-500/20"
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
                <button 
                  onClick={handleDownload}
                  className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200"
                >
                  <Download size={20} />
                </button>
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
                    <p className="text-sm">{t('readyToCreate')}</p>
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
                    className="p-4 bg-brand-100 text-brand-700 rounded-2xl hover:bg-brand-200 transition-all border border-brand-200"
                    title="Schedule for later"
                  >
                    <Calendar size={24} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PosterGen;
