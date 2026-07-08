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
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';
import { cn } from '../lib/utils';

const AdsManager: React.FC = () => {
  const { t, language } = useLanguage();
  const [targetQuery, setTargetQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [strategy, setStrategy] = useState<string | null>(() => localStorage.getItem('ads_strategy'));

  const [isScalingActive, setIsScalingActive] = useState(() => localStorage.getItem('ads_scaling_active') === 'true');

  const handleActivateScaling = () => {
    const newState = !isScalingActive;
    setIsScalingActive(newState);
    localStorage.setItem('ads_scaling_active', newState ? 'true' : 'false');
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

      const response = await fetch('/api/ads-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: targetQuery, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate strategy.');
      const text = data.strategy || 'No strategy generated.';
      setStrategy(text);
      localStorage.setItem('ads_strategy', text);
    } catch (error: any) {
      console.error(error);
      setStrategy(error.message || 'Error generating strategy.');
    } finally {
      setIsGenerating(false);
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
                  <button className="flex items-center gap-2 px-6 py-3 bg-brand-50 text-brand-600 rounded-2xl font-bold text-sm hover:bg-white border border-brand-100 shadow-sm transition-all group">
                    {t('nextStepCreateAd')}
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
                
                <div className="prose prose-brand max-w-none">
                  <div className="whitespace-pre-wrap text-brand-700 leading-relaxed font-sans">
                    {strategy}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default AdsManager;
