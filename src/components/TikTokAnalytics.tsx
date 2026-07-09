import React, { useState, useEffect } from 'react';
import { 
  Eye, 
  Heart, 
  BarChart3, 
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Settings2,
  X,
  Share2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { useLanguage } from '../contexts/LanguageContext';

const TikTokAnalytics: React.FC = () => {
  const { t } = useLanguage();
  const [handle, setHandle] = useState(() => localStorage.getItem('tiktok_handle') || 'ai.cafe4');
  const [isEditingHandle, setIsEditingHandle] = useState(false);
  const [tempHandle, setTempHandle] = useState(handle);
  const [posts, setPosts] = useState<any[]>([]);
  const [publicStats, setPublicStats] = useState<any>(() => {
    const saved = localStorage.getItem('tiktok_stats');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsErrorCode, setStatsErrorCode] = useState<string | null>(null);

  const fetchPublicStats = async () => {
    setSyncing(true);
    setStatsError(null);
    setStatsErrorCode(null);
    try {
      const response = await fetch(`/api/tiktok/stats?t=${Date.now()}`, { credentials: 'include' });
      const data = await response.json();
      if (!response.ok) {
        setStatsErrorCode(data.code || 'sync_error');
        throw new Error(data.error || `Server returned ${response.status}`);
      }
      setPublicStats(data);
      if (data.handle) {
        setHandle(data.handle);
        localStorage.setItem('tiktok_handle', data.handle);
      }
      localStorage.setItem('tiktok_stats', JSON.stringify(data));
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      console.error("Fetch stats error:", err);
      setStatsError(err.message || 'Unable to sync TikTok statistics.');
    } finally {
      setSyncing(false);
    }
  };

  const saveHandle = (newHandle: string) => {
    let cleanHandle = newHandle.trim();
    
    // Support full URLs
    if (cleanHandle.includes('tiktok.com/@')) {
      const splitAt = cleanHandle.split('tiktok.com/@');
      if (splitAt[1]) {
        cleanHandle = splitAt[1].split('?')[0].split('/')[0];
      }
    } else if (cleanHandle.includes('tiktok.com/')) {
      const splitAt = cleanHandle.split('tiktok.com/');
      if (splitAt[1]) {
        const potential = splitAt[1].split('?')[0].split('/')[0];
        cleanHandle = potential.startsWith('@') ? potential.substring(1) : potential;
      }
    }

    // Standard cleaning: remove @, remove all spaces, remove non-alphanumeric chars that shouldn't be in a handle
    // TikTok handles can have letters, numbers, underscores, and dots (but dots are not used in @ handles usually, but let's be safe)
    cleanHandle = cleanHandle.replace(/^@/, '').replace(/\s+/g, '').trim();
    
    if (cleanHandle) {
      setHandle(cleanHandle);
      localStorage.setItem('tiktok_handle', cleanHandle);
      setIsEditingHandle(false);
      // Data will be fetched via useEffect
    }
  };

  useEffect(() => {
    fetchPublicStats();
    
    // Auto-refresh stats every 1 minute
    const intervalId = setInterval(fetchPublicStats, 60000);

    const handleAuthSuccess = (event: MessageEvent) => {
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
        fetchPublicStats();
      }
    };
    window.addEventListener('message', handleAuthSuccess);
    
    setLoading(true);
    const q = query(
      collection(db, 'tiktok_posts'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const postsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPosts(postsData);
      setLoading(false);
    }, (error) => {
      console.error('TikTok posts listener error:', error);
      setPosts([]);
      setLoading(false);
    });

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('message', handleAuthSuccess);
      unsubscribe();
    };
  }, [handle]);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
            {t('tiktokActivity')}
            <BarChart3 className="text-brand-500" size={32} />
          </h2>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-2 px-3 py-1 bg-brand-50 rounded-full border border-brand-100 relative group">
              <div className="w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center text-[10px] text-white font-bold">@</div>
              <span className="text-sm font-bold text-brand-600">{handle}</span>
              
              <button 
                onClick={() => {
                  setTempHandle(handle);
                  setIsEditingHandle(true);
                }}
                className="ml-2 p-1 hover:bg-brand-100 rounded-md text-brand-400 hover:text-brand-600 transition-colors"
                title={t('changeAccount')}
              >
                <Settings2 size={14} />
              </button>

              <AnimatePresence>
                {isEditingHandle && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    className="absolute top-full left-0 mt-2 z-50 glass p-4 rounded-2xl border border-brand-200 shadow-2xl w-64"
                  >
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2 block">{t('enterHandle')}</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 text-sm">@</span>
                        <input 
                          autoFocus
                          type="text"
                          value={tempHandle}
                          onChange={(e) => setTempHandle(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveHandle(tempHandle)}
                          className="w-full pl-7 pr-3 py-2 bg-brand-50 border border-brand-100 rounded-xl text-sm focus:outline-none focus:ring-2 ring-brand-500/20"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <button 
                        onClick={() => setIsEditingHandle(false)}
                        className="px-3 py-1 text-xs text-brand-400 hover:text-brand-600"
                      >
                        {t('cancel')}
                      </button>
                      <button 
                        onClick={() => saveHandle(tempHandle)}
                        className="px-4 py-1 bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm"
                      >
                        {t('save')}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <a 
              href={`https://www.tiktok.com/@${handle}`} 
              target="_blank" 
              rel="no-referrer"
              className="text-xs text-brand-400 hover:text-brand-600 underline font-medium"
            >
              {t('viewOnTikTok')}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden md:block">
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{t('lastUpdated')}</p>
            <p className="text-sm text-brand-600 font-mono">
              {lastUpdated || (publicStats?.updatedAt ? new Date(publicStats.updatedAt).toLocaleTimeString() : t('never'))}
            </p>
          </div>
          <button 
            onClick={fetchPublicStats}
            disabled={syncing}
            className="p-3 bg-brand-50 text-brand-600 rounded-2xl hover:bg-brand-100 transition-all disabled:opacity-50"
          >
            <RefreshCw size={20} className={cn(syncing && "animate-spin")} />
          </button>
          <button 
            onClick={() => window.open('/api/auth/tiktok/redirect', '_blank')}
            className="px-6 py-3 bg-black text-white rounded-2xl font-bold flex items-center gap-2 hover:bg-neutral-800 transition-all shadow-lg"
          >
            <RefreshCw size={18} />
            {t('reconnectAccount')}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { 
            label: t('totalFollowers'), 
            value: syncing ? '...' : publicStats?.followers || '0', 
            icon: Eye, 
            color: 'text-blue-500', 
            bg: 'bg-blue-50' 
          },
          { 
            label: t('totalLikes'), 
            value: syncing ? '...' : publicStats?.likes || '0', 
            icon: Heart, 
            color: 'text-rose-500', 
            bg: 'bg-rose-50' 
          },
          { 
            label: t('following'), 
            value: syncing ? '...' : publicStats?.following || '0', 
            icon: BarChart3, 
            color: 'text-emerald-500', 
            bg: 'bg-emerald-50' 
          },
          { 
            label: t('videoPosts'), 
            value: syncing ? '...' : publicStats?.videoCount || '0', 
            icon: Share2, 
            color: 'text-purple-500', 
            bg: 'bg-purple-50' 
          },
        ].map((stat, i) => (stat && (
          <div key={i} className="glass p-8 rounded-[2rem] border border-white/50 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <stat.icon size={64} />
            </div>
            <div className={cn("p-3 rounded-xl w-fit mb-4", stat.bg, stat.color)}>
              <stat.icon size={24} />
            </div>
            <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mb-1">{stat.label}</p>
            <p className="text-3xl font-display font-bold text-brand-700">
              {stat.value}
            </p>
          </div>
        )))}
      </div>

      {statsError && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">
              {statsErrorCode === 'not_connected' ? 'TikTok account is not connected yet' : 'TikTok statistics are not available yet'}
            </p>
            <p>{statsError}</p>
            {statsErrorCode === 'not_connected' ? (
              <p className="mt-1">Click <strong>Reconnect Account</strong> and authorize the TikTok account you want to connect.</p>
            ) : (
              <p className="mt-1">To show Followers, Likes, Following, and Video Posts, TikTok must approve <code>user.info.stats</code>. Login can still work with <code>user.info.basic</code>.</p>
            )}
          </div>
        </div>
      )}

      <div className="glass p-8 rounded-[2.5rem] border border-white/50 shadow-sm">
        <h3 className="text-xl font-bold text-brand-700 mb-6 flex items-center gap-2">
          <Clock className="text-brand-500" size={24} />
          {t('recentTikTokSyncs')}
        </h3>
        
        <div className="space-y-4">
          {loading ? (
             <div className="flex justify-center p-10"><RefreshCw className="animate-spin text-brand-300" /></div>
          ) : !posts || posts.length === 0 ? (
            <div className="text-center p-10 text-slate-400">{t('noPostsFound')}</div>
          ) : posts.map((post) => (
            <div key={post.id} className="flex items-center justify-between p-6 bg-brand-50/50 rounded-2xl border border-brand-100">
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-black rounded-xl flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                    </svg>
                 </div>
                 <div>
                    <h4 className="font-bold text-brand-700 line-clamp-1">{post.title || 'Untitled AI Generation'}</h4>
                    <p className="text-xs text-slate-500">
                      {post.timestamp?.toDate ? post.timestamp.toDate().toLocaleString() : 'Processing timestamp...'}
                    </p>
                 </div>
              </div>
              <div className="flex items-center gap-2">
                {post.status === 'PUBLISH_COMPLETE' ? (
                  <span className="flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                    <CheckCircle2 size={12} />
                    {t('liveStatus')}
                  </span>
                ) : post.status === 'FAILED' ? (
                  <span className="flex items-center gap-1 px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                    <AlertCircle size={12} />
                    {t('failedStatus')}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-3 py-1 bg-brand-50 text-brand-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                    <RefreshCw size={12} className="animate-spin" />
                    {t('processingStatus')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default TikTokAnalytics;
