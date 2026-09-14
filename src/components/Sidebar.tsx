import React from 'react';
import {
  PenTool,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  ImageIcon,
  Video as VideoIcon,
  TrendingUp,
  Bot,
  ShieldCheck,
  Users,
  MessagesSquare,
  Send,
  ScanSearch,
  Bookmark,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { TabType } from '../types';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onLogout: () => void;
  onOpenBusinessProfile: () => void;
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onLogout,
  onOpenBusinessProfile,
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    onClose();
  };

  const sections = [
    {
      title: t('researchStrategy'),
      items: [
        { id: 'ai-agent', label: 'AI Agent', icon: Bot },
        { id: 'facebook-scanner', label: t('facebookScannerLabel'), icon: ScanSearch },
      ]
    },
    {
      title: t('creativeStudio'),
      items: [
        { id: 'copywriter', label: t('copywriterLabel'), icon: PenTool },
        { id: 'poster-gen', label: t('posterLabel'), icon: ImageIcon },
        { id: 'video-voice', label: t('videoVoiceLabel'), icon: VideoIcon },
      ]
    },
    {
      title: t('growthAutomation'),
      items: [
        { id: 'scheduler', label: t('schedulerLabel'), icon: Calendar },
        { id: 'ads-manager', label: t('adsManagerLabel'), icon: TrendingUp },
        { id: 'tiktok', label: t('tiktokLabel'), icon: BarChart3 },
        { id: 'crm', label: t('crmLabel'), icon: Users },
        { id: 'saved-leads', label: t('savedLeadsLabel'), icon: Bookmark },
        { id: 'automation', label: t('automationLabel'), icon: MessagesSquare },
      ]
    },
    {
      title: 'Admin',
      items: [
        { id: 'security-center', label: 'Security Center', icon: ShieldCheck },
      ]
    }
  ];

  return (
    <aside
      id="app-navigation"
      aria-label="Main navigation"
      className={cn(
        "fixed inset-y-0 left-0 z-[120] flex h-[100dvh] w-[min(19rem,calc(100vw-4rem))] flex-col overflow-y-auto border-r border-brand-600/40 bg-brand-700 text-brand-100 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out dark:border-slate-800 dark:bg-slate-950/95 dark:text-slate-300 dark:shadow-black/30 lg:z-50 lg:w-72 lg:translate-x-0",
        isOpen ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] lg:p-8">
        <h1 className="min-w-0 text-lg font-display font-bold text-white flex items-center gap-3 lg:text-2xl">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-white shadow-lg shadow-brand-500/20 ring-1 ring-white/40 lg:h-12 lg:w-12 lg:rounded-2xl">
            <img
              src="/favicon.svg"
              alt="aime.angkorgate icon"
              className="h-full w-full object-cover"
            />
          </div>
          <span className="truncate tracking-tight">aime.angkorgate</span>
        </h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20 lg:hidden"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-6 pb-6 lg:px-4 lg:space-y-8 lg:pb-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-2">
            <div className="px-4 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-300/40 dark:text-slate-500">{section.title}</p>
            </div>
            {section.items.map((item) => (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleTabChange(item.id as TabType)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 group relative overflow-hidden",
                  activeTab === item.id 
                    ? "bg-white/10 text-white shadow-inner dark:bg-brand-500/15 dark:text-brand-100 dark:ring-1 dark:ring-inset dark:ring-brand-400/20" 
                    : "text-brand-100 hover:bg-white/5 hover:text-white dark:text-slate-300 dark:hover:bg-slate-800/70"
                )}
              >
                {activeTab === item.id && (
                  <motion.div 
                    layoutId="active-pill"
                    className="absolute left-0 w-1 h-6 bg-brand-400 rounded-r-full"
                  />
                )}
                <div className={cn(
                  "transition-colors duration-300",
                  activeTab === item.id ? "text-brand-300" : "text-brand-400/60 group-hover:text-brand-100 dark:text-slate-500 dark:group-hover:text-brand-300"
                )}>
                  {item.id === 'tiktok' ? (
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                    </svg>
                  ) : (
                    <item.icon size={18} />
                  )}
                </div>
                <span className="text-sm font-medium">{item.label}</span>
              </motion.button>
            ))}
          </div>
        ))}
      </nav>

      <div className="p-6 space-y-2">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 dark:from-slate-900 dark:to-slate-800 p-4 rounded-2xl border border-white/10 dark:border-brand-400/20 mb-6 shadow-lg dark:shadow-black/20">
          <p className="text-xs font-bold text-brand-200 dark:text-brand-300 uppercase tracking-wider mb-1">Pro Plan</p>
          <p className="text-[10px] text-brand-100/70 dark:text-slate-400 mb-3">{t('planProSubtitle')}</p>
          <button className="w-full py-2 bg-crab-shell hover:bg-red-700 dark:bg-brand-600 dark:hover:bg-brand-500 text-white text-[10px] font-bold rounded-lg transition-all">
            {t('upgradeNow')}
          </button>
        </div>
        
        <motion.a
          whileTap={{ scale: 0.98 }}
          href="https://t.me/aime_angkorgate_bot"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="w-full flex items-center gap-3 px-4 py-3 text-brand-300/70 hover:bg-white/5 hover:text-white dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-brand-300 rounded-xl transition-all"
        >
          <Bot size={18} />
          <span className="text-sm font-medium">{t('openTelegramBot')}</span>
        </motion.a>
        <motion.a
          whileTap={{ scale: 0.98 }}
          href="https://t.me/aimarketingengine"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="w-full flex items-center gap-3 px-4 py-3 text-brand-300/70 hover:bg-white/5 hover:text-white dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-brand-300 rounded-xl transition-all"
        >
          <Send size={18} />
          <span className="text-sm font-medium">{t('openTelegramChannel')}</span>
        </motion.a>
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            onOpenBusinessProfile();
            onClose();
          }}
          className="w-full flex items-center gap-3 px-4 py-3 text-brand-300/70 hover:bg-white/5 hover:text-white dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-brand-300 rounded-xl transition-all"
        >
          <Settings size={18} />
          <span className="text-sm font-medium">{t('settings')}</span>
        </motion.button>
        <motion.button 
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            onClose();
            onLogout();
          }}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-300 hover:bg-red-500/10 rounded-xl transition-all"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">{t('logout')}</span>
        </motion.button>
      </div>
    </aside>
  );
};

export default Sidebar;
