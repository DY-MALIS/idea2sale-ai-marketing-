import React from 'react';
import {
  PenTool,
  Calendar,
  BarChart3,
  Settings,
  LogOut,
  ImageIcon,
  Video as VideoIcon,
  Search,
  TrendingUp,
  MessagesSquare,
  ShieldCheck,
} from 'lucide-react';
import { motion } from 'motion/react';
import { TabType } from '../types';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onLogout }) => {
  const { t } = useLanguage();

  const sections = [
    {
      title: t('researchStrategy'),
      items: [
        { id: 'product-research', label: t('researchLabel'), icon: Search },
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
        { id: 'automation', label: t('automationLabel'), icon: MessagesSquare },
        { id: 'ads-manager', label: t('adsManagerLabel'), icon: TrendingUp },
        { id: 'tiktok', label: t('tiktokLabel'), icon: BarChart3 },
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
    <div className="w-72 bg-brand-700 text-brand-100 h-screen flex flex-col fixed left-0 top-0 z-50 shadow-2xl overflow-y-auto custom-scrollbar">
      <div className="p-8">
        <h1 className="text-2xl font-display font-bold text-white flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl bg-white shadow-lg shadow-brand-500/20 ring-1 ring-white/40">
            <img
              src="/favicon.svg"
              alt="aime.angkorgate icon"
              className="h-full w-full object-cover"
            />
          </div>
          <span className="tracking-tight">aime.angkorgate</span>
        </h1>
      </div>

      <nav className="flex-1 px-4 space-y-8 pb-8">
        {sections.map((section) => (
          <div key={section.title} className="space-y-2">
            <div className="px-4 mb-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-300/40">{section.title}</p>
            </div>
            {section.items.map((item) => (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => setActiveTab(item.id as TabType)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-300 group relative overflow-hidden",
                  activeTab === item.id 
                    ? "bg-white/10 text-white shadow-inner" 
                    : "hover:bg-white/5 hover:text-slate-100"
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
                  activeTab === item.id ? "text-brand-300" : "text-brand-400/60 group-hover:text-brand-100"
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
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-4 rounded-2xl border border-white/10 mb-6">
          <p className="text-xs font-bold text-brand-200 uppercase tracking-wider mb-1">Pro Plan</p>
          <p className="text-[10px] text-brand-100/70 mb-3">{t('planProSubtitle')}</p>
          <button className="w-full py-2 bg-crab-shell hover:bg-red-700 text-white text-[10px] font-bold rounded-lg transition-all">
            {t('upgradeNow')}
          </button>
        </div>
        
        <motion.button 
          whileTap={{ scale: 0.98 }}
          onClick={() => alert('Settings opened')}
          className="w-full flex items-center gap-3 px-4 py-3 text-brand-300/70 hover:bg-white/5 hover:text-white rounded-xl transition-all"
        >
          <Settings size={18} />
          <span className="text-sm font-medium">{t('settings')}</span>
        </motion.button>
        <motion.button 
          whileTap={{ scale: 0.98 }}
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-300 hover:bg-red-500/10 rounded-xl transition-all"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">{t('logout')}</span>
        </motion.button>
      </div>
    </div>
  );
};

export default Sidebar;
