import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Clock, Trash2, CheckCircle2, AlertCircle, Share2, Instagram, Twitter, X, Send } from 'lucide-react';
import { db, auth } from '../lib/firebase';
import { collection, query, where, onSnapshot, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { SchedulePost } from '../types';
import { format, isAfter, parseISO, addHours, subHours } from 'date-fns';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { deleteLocalMedia, getLocalMediaBlob, getLocalMediaDataUrl } from '../lib/localMediaStore';

const DEMO_DEFAULT_POST_IDS = ['1', '2'];
const TELEGRAM_UPLOAD_TIMEOUT_MS = 180000;

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

const withUploadTimeout = async <T,>(promise: Promise<T>) => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error('Upload is taking too long. Please check your internet connection and try again.')),
      TELEGRAM_UPLOAD_TIMEOUT_MS
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

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
    const defaultPosts: SchedulePost[] = [
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
    return sortScheduledPosts([...savedPosts, ...defaultPosts]);
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
          const localPosts = getLocalScheduledPosts().filter(
            post => post.localOnly && (post.userId === userToUse.uid || post.userId === 'demo-user')
          );
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
    if (!user || isDemoMode) return;

    const savedPosts = getLocalScheduledPosts();
    let changed = false;
    const claimedPosts = savedPosts.map((post) => {
      if (post.localOnly && (!post.userId || post.userId === 'demo-user')) {
        changed = true;
        return { ...post, userId: user.uid };
      }
      return post;
    });

    if (changed) {
      saveLocalScheduledPosts(claimedPosts);
      window.dispatchEvent(new Event('demo-scheduled-posts-updated'));
    }
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

  const uploadLegacyTelegramMedia = async (post: SchedulePost) => {
    if (!user || isDemoMode || !post.mediaDbKey) return '';

    const storedBlob = await getLocalMediaBlob(post.mediaDbKey);
    if (!storedBlob) {
      throw new Error('The saved media file is no longer available in this browser. Please schedule the file again.');
    }

    const idToken = await user.getIdToken();
    const signatureResponse = await fetch('/api/telegram/run-scheduled?action=sign-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` }
    });
    const signatureText = await signatureResponse.text();
    let signatureData: any = {};
    try {
      signatureData = signatureText ? JSON.parse(signatureText) : {};
    } catch {
      throw new Error(`Upload service returned HTTP ${signatureResponse.status} instead of JSON.`);
    }
    if (!signatureResponse.ok || !signatureData.ok) {
      throw new Error(signatureData.error || 'Could not prepare the media upload.');
    }

    const file = storedBlob instanceof File
      ? storedBlob
      : new File([storedBlob], post.mediaName || `telegram-${post.id}`, {
          type: storedBlob.type || (post.mediaType === 'video' ? 'video/mp4' : 'image/jpeg')
        });
    const form = new FormData();
    form.set('file', file);
    form.set('api_key', signatureData.apiKey);
    form.set('timestamp', String(signatureData.timestamp));
    form.set('signature', signatureData.signature);
    form.set('folder', signatureData.folder);

    const uploadResponse = await withUploadTimeout(fetch(signatureData.uploadUrl, {
      method: 'POST',
      body: form
    }));
    const uploadText = await uploadResponse.text();
    let uploadData: any = {};
    try {
      uploadData = uploadText ? JSON.parse(uploadText) : {};
    } catch {
      throw new Error(`Media upload returned HTTP ${uploadResponse.status} instead of JSON.`);
    }
    if (!uploadResponse.ok || !uploadData.secure_url) {
      throw new Error(uploadData?.error?.message || 'Media upload failed.');
    }

    return String(uploadData.secure_url);
  };

  const sendTelegramPost = async (post: SchedulePost) => {
    if (processingTelegram.current.has(post.id)) return;
    processingTelegram.current.add(post.id);

    try {
      let mediaUrl = post.mediaUrl || '';
      let localMediaDataUrl = post.mediaDataUrl || '';

      if (!mediaUrl && post.mediaDbKey && user && !isDemoMode) {
        mediaUrl = await uploadLegacyTelegramMedia(post);
      } else if (!mediaUrl) {
        localMediaDataUrl = localMediaDataUrl || await getLocalMediaDataUrl(post.mediaDbKey);
      }

      const res = await fetch('/api/telegram/run-scheduled?action=post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: post.content,
          mediaUrl,
          mediaDataUrl: localMediaDataUrl,
          mediaName: post.mediaName || '',
          mediaType: post.mediaType || ''
        })
      });
      const responseText = await res.text();
      let data: any = {};
      try {
        data = responseText ? JSON.parse(responseText) : {};
      } catch {
        const tooLarge = res.status === 413 || responseText.toLowerCase().includes('request entity too large');
        throw new Error(
          tooLarge
            ? 'This Demo media request is too large. Sign out, choose Continue as Guest, and schedule it again.'
            : `Telegram service returned HTTP ${res.status} instead of JSON.`
        );
      }

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
        <p className="text-slate-500 text-sm animate-pulse dark:text-slate-400">{t('syncingTimeline')}</p>
      </div>
    );
  }

  return (
    <div className="glass rounded-[2rem] overflow-hidden">
      <div className="p-6 border-b border-brand-100 bg-brand-50 flex items-center justify-between dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <Calendar className="text-brand-500" size={20} />
          <h2 className="text-lg font-bold text-brand-700 tracking-tight dark:text-brand-400">{t('contentTimeline')}</h2>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-white border border-brand-100 rounded-full dark:bg-slate-700 dark:border-slate-600">
           <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
           <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider dark:text-slate-400">{t('liveQueue')}</span>
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
            <div className="w-16 h-16 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-100 dark:bg-slate-800 dark:border-slate-700">
              <Clock size={24} className="text-slate-300" />
            </div>
            <h3 className="text-brand-700 font-bold mb-1 dark:text-brand-400">{t('timelineEmpty')}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('scheduleFirstPost')}</p>
          </div>
        ) : (
          <div className="divide-y divide-brand-100 dark:divide-slate-700">
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
                    className="group relative flex items-start gap-4 p-6 hover:bg-brand-50 transition-colors dark:hover:bg-slate-700"
                  >
                    <div className="flex flex-col items-center gap-1 min-w-[80px]">
                      <div className={`p-2 rounded-xl ${
                        post.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600' : 'bg-brand-50 text-slate-400 border border-brand-100 dark:bg-slate-800 dark:border-slate-700'
                      }`}>
                        {post.platform === 'INSTAGRAM' ? <Instagram size={20} /> : post.platform === 'TWITTER' ? <Twitter size={20} /> : post.platform === 'TELEGRAM' ? <Send size={20} /> : <Share2 size={20} />}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter mt-1 dark:text-slate-400">{post.platform}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                          post.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
                        }`}>
                          {post.status}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono dark:text-slate-400">{timeStr}</span>
                        {post.aiSuggested && (
                          <div className="flex items-center gap-1 text-[10px] text-brand-600 font-bold px-2 py-0.5 bg-brand-50 rounded border border-brand-200 uppercase">
                            <AlertCircle size={10} />
                            {t('aiSuggested')}
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed line-clamp-2 dark:text-slate-300">
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
                      {post.platform !== 'TELEGRAM' && (
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => toggleStatus(post)}
                          className={`p-2 rounded-md transition-colors ${
                            post.status === 'PUBLISHED' ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:text-slate-400'
                          }`}
                        >
                          <CheckCircle2 size={18} />
                        </motion.button>
                      )}
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
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors dark:text-slate-400"
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
