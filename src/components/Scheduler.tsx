import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Clock, Trash2, CheckCircle2, AlertCircle, Share2, Instagram, Twitter, X, Send } from 'lucide-react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { SchedulePost } from '../types';
import { format, isAfter, parseISO, addHours, subHours } from 'date-fns';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';

const Scheduler: React.FC = () => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [posts, setPosts] = useState<SchedulePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const processingTelegram = useRef<Set<string>>(new Set());

  const getDemoPosts = () => {
    const savedPosts = JSON.parse(localStorage.getItem('demo_scheduled_posts') || '[]');
    const now = new Date();
    const defaultPosts = [
      {
        id: '1',
        content: 'Excited to announce our new product launch! Stay tuned for more details at 5 PM today. #NewArrival #PulseSync',
        platform: 'TIKTOK',
        scheduledTime: addHours(now, 2).toISOString(),
        status: 'PENDING',
        userId: 'demo-user',
        aiSuggested: true,
        createdAt: now.toISOString()
      },
      {
        id: '2',
        content: 'How do you streamline your social media workflow? We have a new guide on automation coming up!',
        platform: 'INSTAGRAM',
        scheduledTime: subHours(now, 5).toISOString(),
        status: 'PUBLISHED',
        userId: 'demo-user',
        aiSuggested: false,
        createdAt: subHours(now, 24).toISOString()
      }
    ];
    return [...savedPosts, ...defaultPosts].sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()) as SchedulePost[];
  };

  useEffect(() => {
    let unsubscribe: () => void;

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    if (userToUse) {
      if (isDemoMode) {
        const refreshDemoPosts = () => setPosts(getDemoPosts());
        refreshDemoPosts();
        setLoading(false);
        window.addEventListener('demo-scheduled-posts-updated', refreshDemoPosts);
        unsubscribe = () => window.removeEventListener('demo-scheduled-posts-updated', refreshDemoPosts);
      } else {
        const q = query(
          collection(db, 'scheduled_posts'),
          where('userId', '==', userToUse.uid)
        );

        unsubscribe = onSnapshot(q, 
          (snapshot) => {
            const postsData = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })) as SchedulePost[];
            
            const sortedPosts = postsData.sort((a, b) => 
              new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
            );
            
            setPosts(sortedPosts);
            setLoading(false);
          },
          (error) => {
            console.error("Firestore Error in Scheduler:", error);
            setLoading(false);
          }
        );
      }
    } else {
      setLoading(false);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, isDemoMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const dueTelegramPosts = posts.filter((post) => {
      if (post.platform !== 'TELEGRAM' || post.status !== 'PENDING') return false;
      if (processingTelegram.current.has(post.id)) return false;
      return !isAfter(parseISO(post.scheduledTime), new Date(nowTick));
    });

    if (dueTelegramPosts.length === 0) return;

    dueTelegramPosts.forEach(async (post) => {
      processingTelegram.current.add(post.id);
      try {
        const res = await fetch('/api/telegram/post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: post.content,
            mediaUrl: post.mediaUrl || '',
            mediaType: post.mediaType || ''
          })
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
          throw new Error(data.error || 'Telegram post failed.');
        }

        if (isDemoMode) {
          setPosts(prev => {
            const next = prev.map(p => p.id === post.id ? {
              ...p,
              status: 'PUBLISHED' as const,
              telegramMessageId: data.messageId || null,
              errorMessage: null
            } : p);
            localStorage.setItem('demo_scheduled_posts', JSON.stringify(next.filter(p => !['1', '2'].includes(p.id))));
            return next;
          });
          return;
        }

        await updateDoc(doc(db, 'scheduled_posts', post.id), {
          status: 'PUBLISHED',
          telegramMessageId: data.messageId || null,
          errorMessage: null
        });
      } catch (err: any) {
        console.error('Telegram auto-post failed:', err);
        const msg = err.message || 'Telegram auto-post failed.';
        setErrorMsg(language === 'km' ? 'Telegram បង្ហោះមិនបាន: ' + msg : 'Telegram post failed: ' + msg);
        if (isDemoMode) {
          setPosts(prev => {
            const next = prev.map(p => p.id === post.id ? {
              ...p,
              status: 'FAILED' as const,
              errorMessage: msg
            } : p);
            localStorage.setItem('demo_scheduled_posts', JSON.stringify(next.filter(p => !['1', '2'].includes(p.id))));
            return next;
          });
        } else {
          await updateDoc(doc(db, 'scheduled_posts', post.id), {
            status: 'FAILED',
            errorMessage: msg
          });
        }
      } finally {
        processingTelegram.current.delete(post.id);
      }
    });
  }, [posts, nowTick, isDemoMode, language]);

  const handleDelete = async (id: string) => {
    try {
      if (isDemoMode) {
        setPosts(prev => {
          const next = prev.filter(p => p.id !== id);
          localStorage.setItem('demo_scheduled_posts', JSON.stringify(next.filter(p => !['1', '2'].includes(p.id))));
          return next;
        });
        return;
      }
      await deleteDoc(doc(db, 'scheduled_posts', id));
    } catch (err: any) {
      console.error('Error deleting post:', err);
      const msg = err.message || '';
      setErrorMsg(language === 'km' ? 'មិនអាចលុបបាន៖ ' + msg : 'Failed to delete: ' + msg);
    }
  };

  const toggleStatus = async (post: SchedulePost) => {
    const newStatus: SchedulePost['status'] = post.status === 'PENDING' ? 'PUBLISHED' : 'PENDING';
    try {
      if (isDemoMode) {
        setPosts(prev => {
          const next = prev.map(p => p.id === post.id ? { ...p, status: newStatus } : p);
          localStorage.setItem('demo_scheduled_posts', JSON.stringify(next.filter(p => !['1', '2'].includes(p.id))));
          return next;
        });
        return;
      }
      await updateDoc(doc(db, 'scheduled_posts', post.id), {
        status: newStatus
      });
    } catch (err: any) {
      console.error('Error updating status:', err);
      const msg = err.message || '';
      setErrorMsg(language === 'km' ? 'មិនអាចផ្លាស់ប្តូរស្ថានភាពបាន៖ ' + msg : 'Failed to update status: ' + msg);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-10 h-10 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin" />
        <p className="text-[#8E9299] text-sm animate-pulse">{t('syncingTimeline')}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#151619] border border-[#2A2B2F] rounded-xl overflow-hidden">
      <div className="p-6 border-bottom border-[#2A2B2F] bg-[#1A1B1E] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="text-purple-400" size={20} />
          <h2 className="text-lg font-medium text-white tracking-tight">{t('contentTimeline')}</h2>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-[#2A2B2F] rounded-full">
           <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
           <span className="text-[10px] uppercase font-bold text-[#8E9299] tracking-wider">{t('liveQueue')}</span>
        </div>
      </div>

      <div className="p-0">
        {errorMsg && (
          <div className="m-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3">
            <AlertCircle className="text-red-500 shrink-0" size={20} />
            <p className="text-sm text-red-500 font-medium">{errorMsg}</p>
            <button onClick={() => setErrorMsg(null)} className="ml-auto text-red-500/50 hover:text-red-500">
              <X size={16} />
            </button>
          </div>
        )}
        {posts.length === 0 ? (
          <div className="py-20 text-center px-10">
            <div className="w-16 h-16 bg-[#1A1B1E] rounded-full flex items-center justify-center mx-auto mb-4 border border-[#2A2B2F]">
              <Clock size={24} className="text-[#4A4B4F]" />
            </div>
            <h3 className="text-white font-medium mb-1">{t('timelineEmpty')}</h3>
            <p className="text-sm text-[#8E9299]">{t('scheduleFirstPost')}</p>
          </div>
        ) : (
          <div className="divide-y divide-[#2A2B2F]">
            <AnimatePresence mode='popLayout'>
              {posts.map((post) => {
                const isPast = !isAfter(parseISO(post.scheduledTime), new Date());
                const timeStr = format(parseISO(post.scheduledTime), 'MMM dd, h:mm a');
                
                return (
                  <motion.div
                    key={post.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="group relative flex items-start gap-4 p-6 hover:bg-[#1A1B1E] transition-colors"
                  >
                    <div className="flex flex-col items-center gap-1 min-w-[80px]">
                      <div className={`p-2 rounded-lg ${
                        post.status === 'PUBLISHED' ? 'bg-green-500/10 text-green-400' : 'bg-[#2A2B2F] text-[#8E9299]'
                      }`}>
                        {post.platform === 'INSTAGRAM' ? <Instagram size={20} /> : post.platform === 'TWITTER' ? <Twitter size={20} /> : post.platform === 'TELEGRAM' ? <Send size={20} /> : <Share2 size={20} />}
                      </div>
                      <span className="text-[10px] font-bold text-[#4A4B4F] uppercase tracking-tighter mt-1">{post.platform}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                          post.status === 'PUBLISHED' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                        }`}>
                          {post.status}
                        </span>
                        <span className="text-[10px] text-[#4A4B4F] font-mono">{timeStr}</span>
                        {post.aiSuggested && (
                          <div className="flex items-center gap-1 text-[10px] text-purple-400 font-bold px-2 py-0.5 bg-purple-500/10 rounded border border-purple-500/20 uppercase">
                            <AlertCircle size={10} />
                            {t('aiSuggested')}
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-[#BCBFC4] leading-relaxed line-clamp-2">
                        {post.content}
                      </p>
                      {post.platform === 'TELEGRAM' && post.mediaName && (
                        <p className="mt-2 inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-300">
                          {post.mediaType === 'video' ? 'Video' : 'Image'}: {post.mediaName}
                        </p>
                      )}
                      {post.status === 'FAILED' && post.errorMessage && (
                        <p className="mt-2 text-xs text-red-400">{post.errorMessage}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 transition-opacity">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => toggleStatus(post)}
                        className={`p-2 rounded-md transition-colors ${
                          post.status === 'PUBLISHED' ? 'text-green-500 bg-green-500/5' : 'text-[#8E9299] hover:text-green-500 hover:bg-green-500/10'
                        }`}
                      >
                        <CheckCircle2 size={18} />
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleDelete(post.id)}
                        className="p-2 text-[#8E9299] hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                      >
                        <Trash2 size={18} />
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default Scheduler;
