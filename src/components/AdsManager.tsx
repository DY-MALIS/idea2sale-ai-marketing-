import React, { useState } from 'react';
import { 
  TrendingUp, 
  Target, 
  Users, 
  MousePointer2, 
  CreditCard, 
  Plus,
  Zap,
  BarChart,
  Eye,
  Loader2,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Copy,
  ImagePlus,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { cn } from '../lib/utils';

const AdsManager: React.FC = () => {
  const { t, language } = useLanguage();
  const [targetQuery, setTargetQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(() => localStorage.getItem('ads_strategy'));
  const [isCreatingAd, setIsCreatingAd] = useState(false);
  const [adCreative, setAdCreative] = useState<string | null>(() => localStorage.getItem('ads_creative'));

  const [isScalingActive, setIsScalingActive] = useState(() => localStorage.getItem('ads_scaling_active') === 'true');

  const [productImageBase64, setProductImageBase64] = useState<string | null>(null);
  const [productImageMimeType, setProductImageMimeType] = useState<string | null>(null);
  const [productMediaSource, setProductMediaSource] = useState<'image' | 'video' | null>(null);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState<string | null>(null);
  const [imageAnalysisError, setImageAnalysisError] = useState<string | null>(null);

  const handleActivateScaling = () => {
    const newState = !isScalingActive;
    setIsScalingActive(newState);
    localStorage.setItem('ads_scaling_active', newState ? 'true' : 'false');
  };

  const extractVideoFrame = (file: File): Promise<{ base64: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      const cleanup = () => URL.revokeObjectURL(url);

      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, (video.duration || 1) / 2);
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width || !canvas.height) {
          cleanup();
          reject(new Error('Could not read a frame from this video.'));
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        cleanup();
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
      };
      video.onerror = () => {
        cleanup();
        reject(new Error('Could not read this video file.'));
      };
    });
  };

  const handleAnalyzeImage = async (base64: string, mimeType: string, sourceType: 'image' | 'video') => {
    setIsAnalyzingImage(true);
    setImageAnalysis(null);
    setImageAnalysisError(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'productImageAnalyze', imageBase64: base64, imageMimeType: mimeType, sourceType, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to analyze media.');
      setImageAnalysis(data.analysis || null);
      if (data.productSummary) setTargetQuery(data.productSummary);
    } catch (error: any) {
      setImageAnalysisError(error.message || 'Error analyzing media.');
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  const handleProductImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (file.type.startsWith('video/')) {
      setIsAnalyzingImage(true);
      setImageAnalysis(null);
      setImageAnalysisError(null);
      extractVideoFrame(file)
        .then(({ base64, mimeType }) => {
          setProductImageBase64(base64);
          setProductImageMimeType(mimeType);
          setProductMediaSource('video');
          handleAnalyzeImage(base64, mimeType, 'video');
        })
        .catch((error: any) => {
          setIsAnalyzingImage(false);
          setImageAnalysisError(error.message || 'Could not read this video file.');
        });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      setProductImageBase64(base64);
      setProductImageMimeType(file.type);
      setProductMediaSource('image');
      handleAnalyzeImage(base64, file.type, 'image');
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveProductImage = () => {
    setProductImageBase64(null);
    setProductImageMimeType(null);
    setProductMediaSource(null);
    setImageAnalysis(null);
    setImageAnalysisError(null);
  };

  const handleGenerateStrategy = async () => {
    if (!targetQuery) return;
    setIsGenerating(true);
    setStrategy(null);
    try {
      const prompt = `You are a high-level digital ads strategist. 
      The user wants to run ads for: "${targetQuery}".
      
      CRITICAL INSTRUCTION: 
      - The current application language is set to: ${language === 'km' ? 'Khmer' : 'English'}.
      - Detect the language of the user's input: "${targetQuery}".
      - If either the input is in Khmer OR the application language is Khmer, you MUST provide the strategy ENTIRELY in Khmer.
      - Otherwise, provide it in English.
      
      Structure the response as:
      ### 1. 🎯 Winning Audience Persona (Age, Interests, Behaviors)
      ### 2. ⚡ Hook Ideas (The first 3 seconds of the ad)
      ### 3. 🚀 Campaign Structure (ABO vs CBO)
      ### 4. 💰 Estimated Budgeting
      Keep it concise, high-impact, and professional. Use emojis.`;

      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adsStrategy', query: targetQuery, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate strategy.');
      const text = data.strategy || 'No strategy generated.';
      setStrategy(text);
      setAdCreative(null);
      localStorage.setItem('ads_strategy', text);
      localStorage.removeItem('ads_creative');
    } catch (error: any) {
      console.error(error);
      setStrategy(error.message || 'Error generating strategy.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreateAd = async () => {
    if (!strategy) return;
    setIsCreatingAd(true);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'socialAgent',
          language,
          platform: 'Facebook/TikTok Ads',
          mode: 'create-ad',
          message: `Create a ready-to-launch paid social ad from this strategy.

Product/category:
${targetQuery || 'Use the product implied by the strategy.'}

Strategy:
${strategy}

Return a practical ad package with:
1. Primary ad text
2. Short headline
3. CTA
4. 15-second video ad script
5. Creative direction
6. Audience targeting checklist
7. First test budget suggestion

Keep it ready to copy into TikTok Ads or Meta Ads.`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to create ad.');
      const text = data.text || 'No ad generated.';
      setAdCreative(text);
      localStorage.setItem('ads_creative', text);
    } catch (error: any) {
      setAdCreative(error.message || 'Error creating ad.');
    } finally {
      setIsCreatingAd(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-20">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
            {t('adsManagerLite')}
            <TrendingUp className="text-brand-500" size={32} />
          </h2>
          <p className="text-slate-500 mt-1 text-lg">{t('adsManagerSubtitle')}</p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 px-6 py-3 bg-white border border-brand-200 rounded-2xl shadow-sm">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-sm font-bold text-brand-700">{t('adSyncActive')}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-8">
          <div className="glass p-10 rounded-[2.5rem] shadow-sm space-y-8">
            <div>
              <h3 className="text-xl font-bold text-brand-700 mb-2 flex items-center gap-2">
                <Target size={20} className="text-brand-500" />
                {t('targetAnalysis')}
              </h3>
              <p className="text-sm text-slate-500">{t('defineSellingLabel')}</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="flex items-center justify-center gap-2 w-full py-3 px-4 border-2 border-dashed border-brand-200 rounded-2xl bg-brand-50 hover:bg-brand-100 cursor-pointer transition-all text-sm font-bold text-brand-500">
                  {isAnalyzingImage ? <Loader2 className="animate-spin" size={16} /> : <ImagePlus size={16} />}
                  {isAnalyzingImage ? t('analyzingImage') : t('scanProductBtn')}
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    disabled={isAnalyzingImage}
                    onChange={handleProductImageChange}
                  />
                </label>
                {productImageBase64 && (
                  <div className="flex items-center gap-3 p-2 rounded-2xl bg-brand-50 border border-brand-100">
                    <img
                      src={`data:${productImageMimeType};base64,${productImageBase64}`}
                      className="w-10 h-10 rounded-xl object-cover"
                      alt="Product"
                    />
                    <span className="text-xs text-slate-500 flex-1 truncate">
                      {isAnalyzingImage
                        ? t('analyzingImage')
                        : imageAnalysis
                          ? (productMediaSource === 'video' ? t('videoFrameAnalyzed') : t('imageAnalyzed'))
                          : ''}
                    </span>
                    <button onClick={handleRemoveProductImage} className="text-brand-300 hover:text-red-500 transition-colors">
                      <X size={16} />
                    </button>
                  </div>
                )}
                {imageAnalysisError && <p className="text-xs text-red-500">{imageAnalysisError}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest text-[9px]">{t('productCategoryLabel')}</label>
                <input 
                  type="text"
                  value={targetQuery}
                  onChange={(e) => setTargetQuery(e.target.value)}
                  placeholder={t('productCategoryPlaceholder')}
                  className="w-full px-5 py-4 bg-brand-50 border border-brand-100 rounded-2xl focus:ring-2 focus:ring-brand-500 outline-none transition-all font-medium"
                />
              </div>
              <button 
                onClick={handleGenerateStrategy}
                disabled={isGenerating || !targetQuery}
                className="w-full py-5 bg-brand-700 hover:bg-brand-800 disabled:bg-brand-200 text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-xl shadow-brand-700/20 transition-all"
              >
                {isGenerating ? <Loader2 className="animate-spin" /> : <Zap size={18} />}
                {t('generateStrategyBtn')}
              </button>
            </div>

            <div className="pt-6 border-t border-brand-100 space-y-4">
               {[
                 { label: t('avgCpa'), value: '$8.42', icon: MousePointer2 },
                 { label: t('suggestedBudget'), value: '$25/day', icon: CreditCard },
                 { label: t('audienceSize'), value: '1.2M - 4.5M', icon: Users },
               ].map((stat, i) => (
                 <div key={i} className="flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <stat.icon size={14} className="text-brand-400" />
                     <span className="text-sm text-slate-500">{stat.label}</span>
                   </div>
                   <span className="text-sm font-bold text-brand-700">{stat.value}</span>
                 </div>
               ))}
            </div>
          </div>

          <div className="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-20 group-hover:scale-110 transition-transform duration-700">
               <TrendingUp size={120} />
            </div>
            <h4 className="text-xl font-bold mb-2">{t('automatedAdScaling')}</h4>
            <p className="text-brand-100/80 text-sm mb-6 leading-relaxed">{t('scalingDescription')}</p>
            <button 
              onClick={handleActivateScaling}
              className={cn(
                "w-full py-4 font-bold rounded-xl transition-all shadow-lg",
                isScalingActive 
                  ? "bg-emerald-500 text-white hover:bg-emerald-600" 
                  : "bg-white text-brand-700 hover:bg-brand-50"
              )}
            >
              {isScalingActive ? (
                <span className="flex items-center justify-center gap-2">
                  <CheckCircle2 size={18} />
                  {language === 'km' ? 'កំពុងដំណើរការ' : 'Scaling Active'}
                </span>
              ) : (
                t('activateScalingBtn')
              )}
            </button>
          </div>
        </div>

        <div className="lg:col-span-8 space-y-8">
          {(isAnalyzingImage || imageAnalysis) && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass p-8 rounded-[2.5rem] shadow-sm space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
                  <Eye size={22} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-brand-700 m-0">{t('productImageAnalysisTitle')}</h3>
                  <p className="text-sm text-slate-500 m-0">{t('generatedByAiStrategist')}</p>
                </div>
              </div>
              {isAnalyzingImage ? (
                <div className="flex items-center gap-3 text-brand-500">
                  <Loader2 className="animate-spin" size={18} />
                  <span className="text-sm font-medium">{t('analyzingImage')}</span>
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-brand-700 leading-relaxed text-sm font-sans">
                  {imageAnalysis}
                </div>
              )}
            </motion.div>
          )}
          <AnimatePresence mode="wait">
            {!strategy && !isGenerating ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass p-12 rounded-[3rem] h-full flex flex-col items-center justify-center text-center space-y-6"
              >
                <div className="w-24 h-24 bg-brand-50 rounded-[3rem] flex items-center justify-center border border-brand-100 shadow-inner">
                  <BarChart size={40} className="text-brand-200" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-brand-700">{t('noActiveStrategy')}</h3>
                  <p className="text-slate-500 max-w-sm mx-auto mt-2">{t('enterProductDetailsDesc')}</p>
                </div>
              </motion.div>
            ) : isGenerating ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="glass p-12 rounded-[3rem] h-full flex flex-col items-center justify-center text-center space-y-6"
              >
                <div className="relative">
                  <div className="w-20 h-20 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin" />
                  <Sparkles className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-brand-600 animate-pulse" size={24} />
                </div>
                <div>
                  <p className="text-xl font-bold text-brand-700 animate-pulse">{t('analyzingMarketSegments')}</p>
                  <p className="text-brand-500">{t('findingProfitableAudience')}</p>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass p-12 rounded-[3rem] shadow-sm flex flex-col gap-8"
              >
                <div className="flex justify-between items-center pb-6 border-b border-brand-100">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-brand-50 text-brand-600 rounded-2xl">
                      <Zap size={24} />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-brand-700 m-0">{t('recommendedAdStrategy')}</h3>
                      <p className="text-sm text-slate-500 m-0">{t('generatedByAiStrategist')}</p>
                    </div>
                  </div>
                  <button
                    onClick={handleCreateAd}
                    disabled={isCreatingAd}
                    className="flex items-center gap-2 px-6 py-3 bg-brand-50 text-brand-600 rounded-2xl font-bold text-sm hover:bg-white border border-brand-100 shadow-sm transition-all group disabled:opacity-60"
                  >
                    {isCreatingAd ? (language === 'km' ? 'កំពុងបង្កើត...' : 'Creating...') : t('nextStepCreateAd')}
                    {isCreatingAd ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
                  </button>
                </div>
                
                <div className="prose prose-brand max-w-none">
                  <div className="whitespace-pre-wrap text-brand-700 leading-relaxed font-sans">
                    {strategy}
                  </div>
                </div>

                {adCreative && (
                  <div className="rounded-[2rem] border border-brand-100 bg-brand-50/70 p-6 space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <h4 className="text-lg font-bold text-brand-700 m-0">
                        {language === 'km' ? 'Ad ដែលត្រៀមប្រើបាន' : 'Ready-to-Use Ad'}
                      </h4>
                      <button
                        onClick={() => navigator.clipboard.writeText(adCreative)}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-brand-600 rounded-xl border border-brand-100 text-sm font-bold hover:bg-brand-50 transition-all"
                      >
                        <Copy size={16} />
                        {language === 'km' ? 'ចម្លង' : 'Copy'}
                      </button>
                    </div>
                    <div className="whitespace-pre-wrap text-brand-700 leading-relaxed">
                      {adCreative}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default AdsManager;
