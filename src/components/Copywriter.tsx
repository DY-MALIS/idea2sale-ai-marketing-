import React, { useState } from 'react';
import { 
  Sparkles, 
  Copy, 
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';

const Copywriter: React.FC = () => {
    const { t, language } = useLanguage();
    const [copyPrompt, setCopyPrompt] = useState(() => localStorage.getItem('copy_prompt') || '');
    const [contentType, setContentType] = useState<'caption' | 'salepage' | 'script' | 'seo'>(
      (localStorage.getItem('copy_content_type') as any) || 'caption'
    );
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<string | null>(() => localStorage.getItem('copy_result'));
    const [needsApiKey, setNeedsApiKey] = useState(false);
  
    const handleGenerateCopy = async () => {
      if (!copyPrompt) return;
      setLoading(true);
      setResult(null);
      setNeedsApiKey(false);
      try {
      const response = await fetch('/api/copywriter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: copyPrompt, contentType, language })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error generating content.');
      
      const text = data.text || t('noResponseGenerated');
      setResult(text);
      localStorage.setItem('copy_result', text);
      localStorage.setItem('copy_prompt', copyPrompt);
      localStorage.setItem('copy_content_type', contentType);
    } catch (error: any) {
      console.error(error);
      if (/api key|OPEN_ROUTER_API_KEY|invalid|expired/i.test(error.message || '')) {
        setNeedsApiKey(true);
      }
      setResult(error.message || t('errorGeneratingContent'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      const blob = new Blob([result], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `idea2sale-copy-${Date.now()}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <header>
        <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
          {t('aiCopywriter')}
          <Sparkles className="text-brand-500 animate-pulse" size={32} />
        </h2>
        <p className="text-slate-500 mt-1 text-lg">{t('copywriterSubtitle')}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5 space-y-8">
          <div className="glass p-8 rounded-[2.5rem] space-y-6 relative overflow-hidden">
            <div className="space-y-4">
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('contentType')}</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'caption', label: t('caption') },
                  { id: 'salepage', label: t('salePage') },
                  { id: 'script', label: t('videoScript') },
                  { id: 'seo', label: t('seoKeywords') },
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => setContentType(type.id as any)}
                    className={cn(
                      "px-4 py-3 rounded-xl text-xs font-bold transition-all border",
                      contentType === type.id 
                        ? "bg-brand-700 text-white border-brand-700 shadow-md" 
                        : "bg-brand-50 text-brand-500 border-brand-100 hover:border-brand-300"
                    )}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('campaignGoal')}</label>
              <textarea
                value={copyPrompt}
                onChange={(e) => setCopyPrompt(e.target.value)}
                placeholder={t('copyPromptPlaceholder')}
                className="w-full h-56 p-5 rounded-2xl bg-brand-50 border border-brand-200 focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all resize-none font-medium"
              />
            </div>
            
            <button
              onClick={handleGenerateCopy}
              disabled={loading || !copyPrompt}
              className="w-full bg-gradient-to-r from-brand-600 to-crab-shell hover:from-brand-700 hover:to-crab-shell/90 disabled:from-brand-200 disabled:to-brand-300 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 transition-all shadow-xl shadow-brand-500/20 group relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-white/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 skew-x-[-20deg]" />
              {loading ? <Loader2 className="animate-spin" /> : <Sparkles size={22} />}
              <span className="text-lg">{loading ? t('generatingMagic') : t('generateWithAi')}</span>
            </button>
          </div>

          <div className="bg-brand-50/40 backdrop-blur-sm p-8 rounded-[2rem] border border-brand-200 shadow-sm">
            <h4 className="font-bold text-brand-700 mb-4 flex items-center gap-2 text-lg">
              <RefreshCw size={20} className="text-brand-500" />
              {t('aiProTips')}
            </h4>
            <ul className="text-sm text-brand-600 space-y-3">
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 shrink-0" />
                {t('tip1')}
              </li>
              <li className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-crab-shell mt-1.5 shrink-0" />
                {t('tip2')}
              </li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="glass p-8 rounded-[2.5rem] min-h-[600px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2">
                <div className="w-2 h-6 bg-brand-500 rounded-full" />
                {t('aiGenerationResult')}
              </h3>
              {result && (
                <div className="flex gap-3">
                  <button 
                    onClick={() => navigator.clipboard.writeText(result)}
                    className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200"
                  >
                    <Copy size={20} />
                  </button>
                  <button 
                    onClick={handleDownload}
                    className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200"
                  >
                    <Download size={20} />
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 flex flex-col">
              {!result && !loading && (
                <div className="flex-1 flex flex-col items-center justify-center text-brand-300 space-y-6">
                  <div className="w-24 h-24 bg-brand-50 rounded-[2rem] flex items-center justify-center border border-brand-100 shadow-inner">
                    <Sparkles size={40} className="text-brand-200" />
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-medium text-brand-500">{t('readyToCreate')}</p>
                    <p className="text-sm">{t('copyWillAppear')}</p>
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
                {result && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="prose prose-brand max-w-none bg-brand-50/50 p-8 rounded-3xl border border-brand-100"
                  >
                    <Markdown>{result}</Markdown>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Copywriter;
