import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Clock, Trash2, CheckCircle2, AlertCircle, Share2, Instagram, Twitter, X, Send } from 'lucide-react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { SchedulePost } from '../types';
import { format, isAfter, parseISO, addHours, subHours } from 'date-fns';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { deleteLocalMedia, getLocalMediaDataUrl } from '../lib/localMediaStore';

const DEMO_DEFAULT_POST_IDS = ['1', '2'];

const getLocalScheduledPosts = (): SchedulePost[] => {
  try {
    return JSON.parse(localStorage.getItem('demo_scheduled_posts') || '[]') as SchedulePost[];
  } catch {
    return [];
  }
};

const saveLocalScheduledPosts = (posts: SchedulePost[]) => {
  const compactPosts = posts
    .filter(p => !DEMO_DEFAULT_POST_IDS.includes(p.id))
    .map(({ mediaDataUrl, ...post }) => post);
  localStorage.removeItem('demo_scheduled_posts');
  localStorage.setItem(
    'demo_scheduled_posts',
    JSON.stringify(compactPosts)
  );
};

const sortScheduledPosts = (posts: SchedulePost[]) =>
  [...posts].sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());

const Scheduler: React.FC = () => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [posts, setPosts] = useState<SchedulePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const processingTelegram = useRef<Set<string>>(new Set());

  const getDemoPosts = () => {
    const savedPosts = getLocalScheduledPosts();
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
    return sortScheduledPosts([...savedPosts, ...defaultPosts]) as SchedulePost[];
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

        let remotePosts: SchedulePost[] = [];
        const mergeLocalAndRemotePosts = () => {
          const localPosts = getLocalScheduledPosts().filter(post => post.localOnly && post.userId === userToUse.uid);
          setPosts(sortScheduledPosts([...localPosts, ...remotePosts]));
        };

        const unsubscribeSnapshot = onSnapshot(q, 
          (snapshot) => {
            remotePosts = snapshot.docs.map(doc => ({
              id: doc.id,
              ...doc.data()
            })) as SchedulePost[];
            mergeLocalAndRemotePosts();
            setLoading(false);
          },
          (error) => {
            console.error("Firestore Error in Scheduler:", error);
            mergeLocalAndRemotePosts();
            setLoading(false);
          }
        );

        window.addEventListener('demo-scheduled-posts-updated', mergeLocalAndRemotePosts);
        mergeLocalAndRemotePosts();
        unsubscribe = () => {
          unsubscribeSnapshot();
          window.removeEventListener('demo-scheduled-posts-updated', mergeLocalAndRemotePosts);
        };
      }
    } else {
      setLoading(false);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, isDemoMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 5000);
    const refreshNow = () => setNowTick(Date.now());
    window.addEventListener('focus', refreshNow);
    document.addEventListener('visibilitychange', refreshNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshNow);
      document.removeEventListener('visibilitychange', refreshNow);
    };
  }, []);

  const markPostStatus = async (post: SchedulePost, status: SchedulePost['status']) => {
    if (isDemoMode || post.localOnly) {
      setPosts(prev => {
        const next = prev.map(p => p.id === post.id ? { ...p, status } : p);
        saveLocalScheduledPosts(next);
        return next;
      });
      return;
    }

    await updateDoc(doc(db, 'scheduled_posts', post.id), { status });
  };

  const sendTelegramPost = async (post: SchedulePost) => {
    if (processingTelegram.current.has(post.id)) return;
    processingTelegram.current.add(post.id);

    try {
      const localMediaDataUrl = post.mediaDataUrl || await getLocalMediaDataUrl(post.mediaDbKey);
      const res = await fetch('/api/telegram/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: post.content,
          mediaUrl: post.mediaUrl || '',
          mediaDataUrl: localMediaDataUrl,
          mediaName: post.mediaName || '',
          mediaType: post.mediaType || ''
        })
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Telegram post failed.');
      }

      await markPostStatus(post, 'PUBLISHED');
      await deleteLocalMedia(post.mediaDbKey);
    } catch (err: any) {
      console.error('Telegram auto-post failed:', err);
      const msg = err.message || 'Telegram auto-post failed.';
      setErrorMsg(language === 'km' ? 'Telegram បង្ហោះមិនបាន: ' + msg : 'Telegram post failed: ' + msg);
      await markPostStatus(post, 'FAILED');
    } finally {
      processingTelegram.current.delete(post.id);
    }
  };

  useEffect(() => {
    const dueTelegramPosts = posts.filter((post) => {
      if (post.platform !== 'TELEGRAM' || post.status !== 'PENDING') return false;
      if (processingTelegram.current.has(post.id)) return false;
      return !isAfter(parseISO(post.scheduledTime), new Date(nowTick));
    });

    if (dueTelegramPosts.length === 0) return;

    dueTelegramPosts.forEach((post) => sendTelegramPost(post));
  }, [posts, nowTick, isDemoMode, language]);

  const handleDelete = async (id: string) => {
    try {
      const postToDelete = posts.find(p => p.id === id);
      if (isDemoMode || postToDelete?.localOnly) {
        setPosts(prev => {
          const next = prev.filter(p => p.id !== id);
          saveLocalScheduledPosts(next);
          return next;
        });
        await deleteLocalMedia(postToDelete?.mediaDbKey);
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
      if (isDemoMode || post.localOnly) {
        setPosts(prev => {
          const next = prev.map(p => p.id === post.id ? { ...p, status: newStatus } : p);
          saveLocalScheduledPosts(next);
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
        <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        <p className="text-slate-500 text-sm animate-pulse">{t('syncingTimeline')}</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-[2rem] overflow-hidden">
      <div className="p-6 border-b border-brand-100 bg-brand-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="text-brand-500" size={20} />
          <h2 className="text-lg font-bold text-brand-700 tracking-tight">{t('contentTimeline')}</h2>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-white border border-brand-100 rounded-full">
           <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
           <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{t('liveQueue')}</span>
        </div>
      </div>

      <div className="p-0">
        {errorMsg && (
          <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3">
            <AlertCircle className="text-red-500 shrink-0" size={20} />
            <p className="text-sm text-red-500 font-medium">{errorMsg}</p>
            <button onClick={() => setErrorMsg(null)} className="ml-auto text-red-400 hover:text-red-500">
              <X size={16} />
            </button>
          </div>
        )}
        {posts.length === 0 ? (
          <div className="py-20 text-center px-10">
            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-100">
              <Clock size={24} className="text-slate-300" />
            </div>
            <h3 className="text-brand-700 font-bold mb-1">{t('timelineEmpty')}</h3>
            <p className="text-sm text-slate-500">{t('scheduleFirstPost')}</p>
          </div>
        ) : (
          <div className="divide-y divide-brand-100">
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
                    className="group relative flex items-start gap-4 p-6 hover:bg-brand-50 transition-colors"
                  >
                    <div className="flex flex-col items-center gap-1 min-w-[80px]">
                      <div className={`p-2 rounded-xl ${
                        post.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-slate-400 border border-brand-100'
                      }`}>
                        {post.platform === 'INSTAGRAM' ? <Instagram size={20} /> : post.platform === 'TWITTER' ? <Twitter size={20} /> : post.platform === 'TELEGRAM' ? <Send size={20} /> : <Share2 size={20} />}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{post.platform}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                          post.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
                        }`}>
                          {post.status}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">{timeStr}</span>
                        {post.aiSuggested && (
                          <div className="flex items-center gap-1 text-[10px] text-brand-600 font-bold px-2 py-0.5 bg-brand-50 rounded border border-brand-200 uppercase">
                            <AlertCircle size={10} />
                            {t('aiSuggested')}
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">
                        {post.content}
                      </p>
                      {post.platform === 'TELEGRAM' && post.mediaName && (
                        <p className="mt-2 inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-600">
                          {post.mediaType === 'video' ? 'Video' : 'Image'}: {post.mediaName}
                        </p>
                      )}
                      {post.status === 'FAILED' && post.errorMessage && (
                        <p className="mt-2 text-xs text-red-500">{post.errorMessage}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 transition-opacity">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => toggleStatus(post)}
                        className={`p-2 rounded-md transition-colors ${
                          post.status === 'PUBLISHED' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        <CheckCircle2 size={18} />
                      </motion.button>
                      {post.platform === 'TELEGRAM' && post.status === 'PENDING' && (
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => sendTelegramPost(post)}
                          className="p-2 text-sky-500 hover:text-sky-600 hover:bg-sky-50 rounded-md transition-colors"
                          title="Send to Telegram now"
                        >
                          <Send size={18} />
                        </motion.button>
                      )}
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => handleDelete(post.id)}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
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
