import React, { useState } from 'react';
import {
  Search,
  TrendingUp,
  Target,
  BarChart2,
  ArrowUpRight,
  Package,
  Loader2,
  Radar,
  Heart
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../contexts/LanguageContext';

const ProductResearch: React.FC = () => {
    const { t, language } = useLanguage();
    const [queryInput, setQueryInput] = useState(() => localStorage.getItem('research_query') || '');
    const [isSearching, setIsSearching] = useState(false);
    const [analysis, setAnalysis] = useState<string | null>(() => localStorage.getItem('research_analysis'));

    const [competitorInput, setCompetitorInput] = useState('');
    const [isTrackingCompetitor, setIsTrackingCompetitor] = useState(false);
    const [competitorReport, setCompetitorReport] = useState<string | null>(null);
    const [competitorError, setCompetitorError] = useState<string | null>(null);

    const [brandInput, setBrandInput] = useState('');
    const [isCheckingSentiment, setIsCheckingSentiment] = useState(false);
    const [sentimentReport, setSentimentReport] = useState<string | null>(null);
    const [sentimentError, setSentimentError] = useState<string | null>(null);

    const handleSearch = async () => {
      const query = queryInput.trim();
      if (!query) return;
      setIsSearching(true);
      setAnalysis(null);
      try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'productResearch', query, language }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || t('errorPerformingResearch'));
      }

      const text = data.analysis || t('noDataGenerated');
      setAnalysis(text);
      localStorage.setItem('research_analysis', text);
      localStorage.setItem('research_query', query);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : t('errorPerformingResearch');
      setAnalysis(message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleTrackCompetitor = async () => {
    const competitor = competitorInput.trim();
    if (!competitor) return;
    setIsTrackingCompetitor(true);
    setCompetitorReport(null);
    setCompetitorError(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'competitorTracker', competitor, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t('errorPerformingResearch'));
      setCompetitorReport(data.report || t('noDataGenerated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errorPerformingResearch');
      setCompetitorError(message);
    } finally {
      setIsTrackingCompetitor(false);
    }
  };

  const handleCheckSentiment = async () => {
    const brand = brandInput.trim();
    if (!brand) return;
    setIsCheckingSentiment(true);
    setSentimentReport(null);
    setSentimentError(null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'brandSentiment', brand, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || t('errorPerformingResearch'));
      setSentimentReport(data.report || t('noDataGenerated'));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errorPerformingResearch');
      setSentimentError(message);
    } finally {
      setIsCheckingSentiment(false);
    }
  };

  const trendingProducts = [
    { name: 'Ergonomic Standing Desk', growth: '+142%', category: 'Office' },
    { name: 'Portable Blender Pro', growth: '+89%', category: 'Kitchen' },
    { name: 'Smart Pet Feeder AI', growth: '+210%', category: 'Pets' },
    { name: 'Linen Summer Set', growth: '+320%', category: 'Fashion' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-20">
      <header>
        <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
          {t('productResearchTitle')}
          <Search className="text-brand-500" size={32} />
        </h2>
        <p className="text-slate-500 mt-1 text-lg">{t('productResearchSubtitle')}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          <div className="glass p-10 rounded-[2.5rem] shadow-sm relative overflow-hidden">
            <div className="relative z-10 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('researchNicheLabel')}</label>
                <div className="relative">
                  <input
                    type="text"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder={t('searchPlaceholder')}
                    className="w-full pl-14 pr-6 py-5 bg-brand-50 border border-brand-200 rounded-3xl focus:ring-2 focus:ring-brand-500 focus:bg-white outline-none transition-all text-lg font-medium"
                  />
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-brand-400" size={24} />
                </div>
              </div>

              <button
                onClick={handleSearch}
                disabled={isSearching || !queryInput}
                className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-brand-200 text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl transition-all"
              >
                {isSearching ? <Loader2 className="animate-spin" /> : <Target size={20} />}
                <span>{isSearching ? t('analyzingMarket') : t('runDeepResearch')}</span>
              </button>
            </div>
          </div>

          <AnimatePresence>
            {analysis && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass p-10 rounded-[2.5rem] shadow-sm prose prose-brand max-w-none"
              >
                <div className="flex items-center gap-2 mb-6 text-brand-700">
                  <BarChart2 size={24} />
                  <h3 className="text-2xl font-bold m-0">{t('aiResearchInsights')}</h3>
                </div>
                <div className="whitespace-pre-wrap text-brand-600 leading-relaxed font-sans">
                  {analysis}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(isTrackingCompetitor || competitorReport || competitorError) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass p-10 rounded-[2.5rem] shadow-sm prose prose-brand max-w-none"
              >
                <div className="flex items-center gap-2 mb-6 text-brand-700">
                  <Radar size={24} />
                  <h3 className="text-2xl font-bold m-0">{t('competitorReportTitle')}</h3>
                </div>
                {isTrackingCompetitor ? (
                  <div className="flex items-center gap-3 text-brand-500">
                    <Loader2 className="animate-spin" size={20} />
                    <span className="text-sm font-medium">{t('trackingCompetitor')}</span>
                  </div>
                ) : competitorError ? (
                  <p className="text-sm text-red-500">{competitorError}</p>
                ) : (
                  <div className="whitespace-pre-wrap text-brand-600 leading-relaxed font-sans">
                    {competitorReport}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {(isCheckingSentiment || sentimentReport || sentimentError) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass p-10 rounded-[2.5rem] shadow-sm prose prose-brand max-w-none"
              >
                <div className="flex items-center gap-2 mb-6 text-brand-700">
                  <Heart size={24} />
                  <h3 className="text-2xl font-bold m-0">{t('sentimentReportTitle')}</h3>
                </div>
                {isCheckingSentiment ? (
                  <div className="flex items-center gap-3 text-brand-500">
                    <Loader2 className="animate-spin" size={20} />
                    <span className="text-sm font-medium">{t('checkingSentiment')}</span>
                  </div>
                ) : sentimentError ? (
                  <p className="text-sm text-red-500">{sentimentError}</p>
                ) : (
                  <div className="whitespace-pre-wrap text-brand-600 leading-relaxed font-sans">
                    {sentimentReport}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="lg:col-span-4 space-y-8">
          <div className="glass p-8 rounded-[2rem] border border-brand-100 shadow-sm relative overflow-hidden">
            <h3 className="text-lg font-bold text-brand-700 mb-6 flex items-center gap-2">
              <TrendingUp size={20} className="text-emerald-500" />
              {t('tiktokTrendingNow')}
            </h3>
            <div className="space-y-4">
              {trendingProducts.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-brand-50/50 rounded-2xl border border-brand-100 hover:border-brand-300 transition-all cursor-pointer group">
                  <div>
                    <p className="font-bold text-brand-700 group-hover:text-brand-600 transition-colors">{item.name}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">{item.category}</p>
                  </div>
                  <div className="text-emerald-600 font-bold flex items-center gap-1 bg-emerald-50 px-2 py-1 rounded-lg">
                    {item.growth}
                    <ArrowUpRight size={14} />
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-6 py-4 bg-brand-50 text-brand-600 font-bold rounded-xl text-sm hover:bg-brand-100 transition-all border border-brand-100">
              {t('explorerFullList')}
            </button>
          </div>

          <div className="bg-gradient-to-br from-brand-600 to-crab-shell p-8 rounded-[2rem] text-white shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
              <Package size={80} />
            </div>
            <h4 className="text-xl font-bold mb-2">{t('competitorTracking')}</h4>
            <p className="text-brand-100 text-sm mb-6 leading-relaxed">{t('competitorTrackingDesc')}</p>
            <input
              type="text"
              value={competitorInput}
              onChange={(e) => setCompetitorInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTrackCompetitor()}
              placeholder={t('competitorNamePlaceholder')}
              className="w-full px-4 py-3 mb-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/60 focus:ring-2 focus:ring-white/40 outline-none transition-all text-sm font-medium"
            />
            <button
              onClick={handleTrackCompetitor}
              disabled={isTrackingCompetitor || !competitorInput.trim()}
              className="w-full py-4 bg-white/20 hover:bg-white/30 disabled:opacity-50 backdrop-blur-md rounded-xl font-bold transition-all border border-white/20 flex items-center justify-center gap-2"
            >
              {isTrackingCompetitor ? <Loader2 className="animate-spin" size={18} /> : <Radar size={18} />}
              {isTrackingCompetitor ? t('trackingCompetitor') : t('trackCompetitorBtn')}
            </button>
          </div>

          <div className="glass p-8 rounded-[2rem] border border-brand-100 shadow-sm relative overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
              <Heart size={20} className="text-brand-500" />
              <h4 className="text-lg font-bold text-brand-700">{t('brandSentimentTitle')}</h4>
            </div>
            <p className="text-slate-500 text-sm mb-6 leading-relaxed">{t('brandSentimentDesc')}</p>
            <input
              type="text"
              value={brandInput}
              onChange={(e) => setBrandInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCheckSentiment()}
              placeholder={t('brandNamePlaceholder')}
              className="w-full px-4 py-3 mb-3 bg-brand-50 border border-brand-100 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none transition-all text-sm font-medium"
            />
            <button
              onClick={handleCheckSentiment}
              disabled={isCheckingSentiment || !brandInput.trim()}
              className="w-full py-4 bg-brand-700 hover:bg-brand-800 disabled:bg-brand-200 text-white font-bold rounded-xl text-sm transition-all flex items-center justify-center gap-2"
            >
              {isCheckingSentiment ? <Loader2 className="animate-spin" size={18} /> : <Heart size={18} />}
              {isCheckingSentiment ? t('checkingSentiment') : t('checkSentimentBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductResearch;
