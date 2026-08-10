import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Info, ExternalLink, Copy, Settings, Globe, Languages, Check, Sun, Moon } from 'lucide-react';
import { cn } from './lib/utils';
import Sidebar from './components/Sidebar';
import Copywriter from './components/Copywriter';
import PosterGen from './components/PosterGen';
import VideoVoice from './components/VideoVoice';
import TikTokAnalytics from './components/TikTokAnalytics';
import ProductResearch from './components/ProductResearch';
import AdsManager from './components/AdsManager';
import SchedulerHub from './components/SchedulerHub';
import AIAgent from './components/AIAgent';
import CRM from './components/CRM';
import Automation from './components/Automation';
import Auth from './components/Auth';
import LegalPage from './components/LegalPage';
import SecurityCenter from './components/SecurityCenter';
import BusinessProfile from './components/BusinessProfile';
import { CreativeAutomationRequest, TabType } from './types';
import { useLanguage } from './contexts/LanguageContext';
import { useAuth } from './contexts/AuthContext';
import { useTheme } from './contexts/ThemeContext';

export default function App() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const isTikTokReviewMode = pathname === '/tiktok-review';
  const [activeTab, setActiveTab] = useState<TabType>(
    isTikTokReviewMode ? 'video-voice' : 'scheduler'
  );
  const { user, isDemoMode, loading: authLoading, setDemoMode, logout } = useAuth();
  const [configInfo, setConfigInfo] = useState<any>(null);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showBusinessProfile, setShowBusinessProfile] = useState(false);
  const [creativeAutomation, setCreativeAutomation] = useState<CreativeAutomationRequest | null>(null);

  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    if (isTikTokReviewMode && !user && !isDemoMode) {
      setDemoMode(true);
    }
  }, [isTikTokReviewMode, isDemoMode, setDemoMode, user]);

  useEffect(() => {
    const handleContextmenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handleContextmenu);
    return () => {
      document.removeEventListener('contextmenu', handleContextmenu);
    };
  }, []);

  const effectivelyAuthenticated = !!user || isDemoMode;
  
  const handleDemoMode = () => {
    setDemoMode(true);
  };

  const handleCreativeAutomation = (request: CreativeAutomationRequest) => {
    setCreativeAutomation(request);
    setActiveTab(request.kind === 'video' ? 'video-voice' : 'poster-gen');
  };

  const consumeCreativeAutomation = (requestId: string) => {
    setCreativeAutomation((current) => current?.id === requestId ? null : current);
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'copywriter': return <Copywriter />;
      case 'poster-gen': return (
        <PosterGen
          automationRequest={creativeAutomation?.kind === 'image' ? creativeAutomation : null}
          onAutomationConsumed={consumeCreativeAutomation}
        />
      );
      case 'video-voice': return (
        <VideoVoice
          automationRequest={creativeAutomation?.kind === 'video' ? creativeAutomation : null}
          onAutomationConsumed={consumeCreativeAutomation}
        />
      );
      case 'tiktok': return <TikTokAnalytics />;
      case 'product-research': return <ProductResearch />;
      case 'ads-manager': return <AdsManager />;
      case 'scheduler': return <SchedulerHub />;
      case 'ai-agent': return <AIAgent onCreativeAutomation={handleCreativeAutomation} />;
      case 'crm': return <CRM />;
      case 'automation': return <Automation />;
      case 'security-center': return <SecurityCenter />;
      default: return <Copywriter />;
    }
  };

  useEffect(() => {
    if (effectivelyAuthenticated) {
      fetch('/api/config/check')
        .then(res => res.json())
        .then(data => setConfigInfo(data))
        .catch(err => console.error("Config check failed", err));
    }
  }, [effectivelyAuthenticated]);

  if (pathname === '/terms-of-service') {
    return <LegalPage type="terms" />;
  }

  if (pathname === '/privacy-policy') {
    return <LegalPage type="privacy" />;
  }

  return (
    <div className="flex flex-col min-h-screen font-sans bg-mesh overflow-x-hidden">
      {/* Top Header with Language Switcher - Always Visible */}
      <div className="fixed top-4 right-4 z-[100] flex items-center gap-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2 bg-white/80 backdrop-blur-md border border-white/50 rounded-full shadow-lg hover:shadow-xl transition-all text-brand-600 dark:bg-slate-800/80 dark:border-white/10 dark:text-brand-400"
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </motion.button>

        <div className="relative">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
            className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-md border border-white/50 rounded-full shadow-lg hover:shadow-xl transition-all text-slate-700 font-medium text-sm dark:bg-slate-800/80 dark:border-white/10 dark:text-slate-200"
          >
            <Languages size={16} className="text-brand-600 dark:text-brand-400" />
            <span>{language === 'km' ? 'ភាសាខ្មែរ' : 'English'}</span>
          </motion.button>

          <AnimatePresence>
            {showLanguageMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute top-full mt-2 right-0 w-40 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden py-1 dark:bg-slate-800 dark:border-slate-700"
              >
                <button
                  onClick={() => {
                    setLanguage('en');
                    setShowLanguageMenu(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${language === 'en' ? 'text-brand-700 font-bold bg-brand-50/50 dark:text-brand-400 dark:bg-slate-700/50' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  <span>English</span>
                  {language === 'en' && <Check size={14} />}
                </button>
                <button
                  onClick={() => {
                    setLanguage('km');
                    setShowLanguageMenu(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors ${language === 'km' ? 'text-brand-700 font-bold bg-brand-50/50 dark:text-brand-400 dark:bg-slate-700/50' : 'text-slate-600 dark:text-slate-300'}`}
                >
                  <span>ភាសាខ្មែរ</span>
                  {language === 'km' && <Check size={14} />}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {effectivelyAuthenticated && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setShowBusinessProfile(true)}
            title={t('businessProfileTitle')}
            className="p-2 bg-white/80 backdrop-blur-md border border-white/50 rounded-full shadow-lg text-slate-400 hover:text-slate-600 transition-colors dark:bg-slate-800/80 dark:border-white/10 dark:text-slate-500 dark:hover:text-slate-300"
          >
            <Settings size={20} />
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {showBusinessProfile && <BusinessProfile onClose={() => setShowBusinessProfile(false)} />}
      </AnimatePresence>

      {authLoading && !isDemoMode ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
            <p className="text-slate-500 dark:text-slate-400 font-medium">{t('processing')}</p>
          </div>
        </div>
      ) : !effectivelyAuthenticated ? (
        <Auth onDemoMode={handleDemoMode} />
      ) : (
        <div className="flex flex-1 relative">
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onLogout={logout}
            onOpenBusinessProfile={() => setShowBusinessProfile(true)}
          />
          
          <main className="flex-1 ml-72 p-10">
            <div className="max-w-7xl mx-auto">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  {renderContent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
