import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Bot, Zap, Plus, Sparkles, Clock, X, Send, Instagram, Twitter, Share2, Loader2, AlertCircle, Upload } from 'lucide-react';
import AITrainer from './AITrainer';
import Suggestions from './Suggestions';
import Scheduler from './Scheduler';
import ActivityPulse from './ActivityPulse';
import { db, storage } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useLanguage } from '../contexts/LanguageContext';
import { saveLocalMedia } from '../lib/localMediaStore';

import { useAuth } from '../contexts/AuthContext';

const MB = 1024 * 1024;
const TELEGRAM_SERVER_MEDIA_LIMIT_MB = 48;
const TELEGRAM_MEDIA_LIMIT_MB = 48;
const DEMO_INLINE_MEDIA_LIMIT_MB = 3;
const UPLOAD_TIMEOUT_MS = 180000;
const LOCAL_POSTS_KEY = 'demo_scheduled_posts';

const getCompactLocalPosts = () => {
  try {
    const savedPosts = JSON.parse(localStorage.getItem(LOCAL_POSTS_KEY) || '[]');
    return savedPosts.map(({ mediaDataUrl, ...post }: any) => post);
  } catch {
    return [];
  }
};

const saveCompactLocalPosts = (posts: any[]) => {
  const compactPosts = posts.map(({ mediaDataUrl, ...post }) => post);
  localStorage.removeItem(LOCAL_POSTS_KEY);
  localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(compactPosts));
};

const SchedulerHub: React.FC = () => {
  const { t } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [activityVersion, setActivityVersion] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Helper for local datetime string
  const getLocalISOString = (date: Date) => {
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime( ) - tzOffset).toISOString().slice(0, 16);
  };
  
  // Form state
  const [content, setContent] = useState('');
  const [platform, setPlatform] = useState<'TIKTOK' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM'>('TIKTOK');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [telegramMediaFile, setTelegramMediaFile] = useState<File | null>(null);
  const [scheduledTime, setScheduledTime] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    nextHour.setMinutes(0);
    return getLocalISOString(nextHour);
  });

  const handleTrainingComplete = () => {
    setActivityVersion(v => v + 1);
  };

  const formatFileSize = (bytes: number) => `${(bytes / MB).toFixed(bytes > 10 * MB ? 0 : 1)} MB`;

  const validateTelegramMedia = (file: File | null, demoMode: boolean) => {
    if (!file) return null;
    if (file.size > TELEGRAM_MEDIA_LIMIT_MB * MB) {
      return `This file is ${formatFileSize(file.size)}. Telegram videos must be under ${TELEGRAM_MEDIA_LIMIT_MB} MB. Please choose a smaller/compressed video.`;
    }
    if (demoMode && file.size > DEMO_INLINE_MEDIA_LIMIT_MB * MB) {
      return `This file is ${formatFileSize(file.size)}. Try Demo Mode supports media under ${DEMO_INLINE_MEDIA_LIMIT_MB} MB. Use Continue as Guest to schedule files up to ${TELEGRAM_MEDIA_LIMIT_MB} MB.`;
    }
    if (!demoMode && file.size > TELEGRAM_SERVER_MEDIA_LIMIT_MB * MB) {
      return `This file is ${formatFileSize(file.size)}. Telegram auto-scheduling currently supports files under ${TELEGRAM_SERVER_MEDIA_LIMIT_MB} MB. Please compress it or choose a smaller file.`;
    }
    return null;
  };

  const uploadTelegramMedia = async (file: File, idToken: string) => {
    const signatureResponse = await fetch('/api/telegram/run-scheduled?action=sign-upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`
      }
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
    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !uploadData.secure_url) {
      throw new Error(uploadData?.error?.message || 'Media upload failed.');
    }

    return {
      mediaUrl: String(uploadData.secure_url),
      mediaType: uploadData.resource_type === 'video' || file.type.startsWith('video/') ? 'video' : 'photo'
    };
  };

  const withUploadTimeout = async <T,>(promise: Promise<T>) => {
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error('Upload is taking too long. Please check your internet connection or use a smaller video.'));
      }, UPLOAD_TIMEOUT_MS);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  };

  const resetFormAfterSchedule = () => {
    setIsModalOpen(false);
    setContent('');
    setVideoFile(null);
    setTelegramMediaFile(null);

    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    nextHour.setMinutes(0);
    setScheduledTime(getLocalISOString(nextHour));
  };

  const saveLocalTelegramSchedule = async (userId: string, scheduledDate: Date) => {
    const postId = Date.now().toString();
    const mediaDbKey = telegramMediaFile ? `telegram-${postId}-${crypto.randomUUID()}` : null;
    if (mediaDbKey && telegramMediaFile) {
      await saveLocalMedia(mediaDbKey, telegramMediaFile);
    }

    const post = {
      id: postId,
      content: content.trim(),
      platform,
      scheduledTime: scheduledDate.toISOString(),
      status: 'PENDING',
      userId,
      aiSuggested: false,
      videoName: videoFile?.name || null,
      mediaDbKey,
      mediaName: telegramMediaFile?.name || null,
      mediaType: telegramMediaFile?.type.startsWith('video/') ? 'video' : telegramMediaFile ? 'photo' : null,
      publishMode: 'TELEGRAM_AUTO_POST_LOCAL',
      localOnly: true,
      createdAt: new Date().toISOString()
    };

    saveCompactLocalPosts([post, ...getCompactLocalPosts()]);
    window.dispatchEvent(new Event('demo-scheduled-posts-updated'));
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    if ((!content.trim() && !(platform === 'TELEGRAM' && telegramMediaFile)) || !scheduledTime || !userToUse || (platform === 'TIKTOK' && !videoFile)) {
      setFormError(t('fillAllFieldsErr'));
      return;
    }

    const scheduledDate = new Date(scheduledTime);
    // datetime-local inputs only carry minute precision, so a time picked as
    // "now" already lost its seconds by the time this check runs. Allow a
    // one-minute grace window so that doesn't read as "in the past".
    if (scheduledDate.getTime() < Date.now() - 60000) {
      setFormError(t('futureTimeErr'));
      return;
    }

    const mediaError = platform === 'TELEGRAM' ? validateTelegramMedia(telegramMediaFile, isDemoMode) : null;
    if (mediaError) {
      setFormError(mediaError);
      return;
    }

    setIsSubmitting(true);

    if (isDemoMode) {
      try {
        await saveLocalTelegramSchedule('demo-user', scheduledDate);
        resetFormAfterSchedule();
      } catch (err) {
        console.error('Error preparing demo media:', err);
        const message = err instanceof Error ? err.message : 'Could not prepare this media file.';
        setFormError(`Failed to save post: ${message}`);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    try {
      let videoUrl = '';
      let mediaUrl = '';
      let mediaType: 'photo' | 'video' | null = null;
      if (platform === 'TELEGRAM') {
        if (!user) throw new Error('Please sign in first.');
        const idToken = await user.getIdToken();
        const uploadedMedia = telegramMediaFile
          ? await uploadTelegramMedia(telegramMediaFile, idToken)
          : null;
        const response = await fetch('/api/telegram/run-scheduled?action=create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({
            content: content.trim(),
            scheduledTime: scheduledDate.toISOString(),
            mediaUrl: uploadedMedia?.mediaUrl || '',
            mediaName: telegramMediaFile?.name || null,
            mediaType: uploadedMedia?.mediaType || null
          })
        });
        const responseText = await response.text();
        let data: any = {};
        try {
          data = responseText ? JSON.parse(responseText) : {};
        } catch {
          throw new Error(`Scheduling service returned HTTP ${response.status} instead of JSON.`);
        }
        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'Could not schedule this Telegram post.');
        }
        resetFormAfterSchedule();
        return;
      }
      if (platform === 'TIKTOK' && videoFile) {
        const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageRef = ref(storage, `scheduled-videos/${userToUse.uid}/${Date.now()}-${safeName}`);
        await withUploadTimeout(uploadBytes(storageRef, videoFile, { contentType: videoFile.type }));
        videoUrl = await getDownloadURL(storageRef);
      }
      await addDoc(collection(db, 'scheduled_posts'), {
        content: content.trim(),
        platform,
        scheduledTime: scheduledDate.toISOString(),
        status: 'PENDING',
        userId: userToUse.uid,
        aiSuggested: false,
        videoUrl,
        videoName: videoFile?.name || null,
        mediaUrl,
        mediaName: telegramMediaFile?.name || null,
        mediaType,
        publishMode: platform === 'TIKTOK' ? 'TIKTOK_DIRECT_POST' : 'PLANNED_ONLY',
        createdAt: serverTimestamp()
      });
      setIsModalOpen(false);
      setContent('');
      setVideoFile(null);
      setTelegramMediaFile(null);
      
      const nextHour = new Date();
      nextHour.setHours(nextHour.getHours() + 1);
      nextHour.setMinutes(0);
      setScheduledTime(getLocalISOString(nextHour));
    } catch (err) {
      console.error('Error creating post:', err);
      const message = err instanceof Error ? err.message : t('failedSavePostErr');
      setFormError(`Failed to save post: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormError(null);
  };

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2 text-brand-500">
            <Sparkles size={16} />
            <span className="text-[10px] uppercase font-bold tracking-[0.2em]">{t('intelligentEngine')}</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-brand-700 tracking-tight dark:text-brand-400">{t('smartScheduler')}</h1>
          <p className="text-slate-500 mt-1 max-w-xl dark:text-slate-400">{t('contentOrchestrationDesc')}</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right">
             <p className="text-[10px] text-brand-400 font-bold uppercase tracking-widest">{t('activeModel')}</p>
             <p className="text-sm text-brand-700 font-mono flex items-center gap-2 dark:text-brand-400">
               <Bot size={14} className="text-brand-500" />
               OpenRouter
             </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-brand-700 hover:bg-brand-800 text-white rounded-2xl font-bold text-sm shadow-xl shadow-brand-700/20 flex items-center gap-2 transition-transform"
          >
            <Plus size={18} />
            {t('scheduleBtn')}
          </motion.button>
        </div>
      </header>

      <div className="rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-sm text-brand-700 flex items-start gap-2 dark:bg-slate-800 dark:border-slate-700 dark:text-brand-400">
        <Zap size={16} className="mt-0.5 shrink-0 text-brand-500" />
        <div>
          <strong className="text-brand-700 dark:text-brand-400">
            {t('smartScheduler')}
          </strong>
          <span className="ml-2 text-slate-600 dark:text-slate-300">
            {t('schedulerRoleDesc')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Training & Suggestions */}
        <div className="lg:col-span-4 space-y-8">
           <AITrainer onTrainingComplete={handleTrainingComplete} />

           <div className="glass rounded-[2rem] p-6 shadow-sm">
             <Suggestions activityVersion={activityVersion} />
           </div>
        </div>

        {/* Right: The Timeline & Pulse */}
        <div className="lg:col-span-8 space-y-8">
           <ActivityPulse version={activityVersion} />
           <Scheduler />
        </div>
      </div>

      {/* Manual Schedule Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white border border-brand-100 rounded-3xl shadow-2xl overflow-hidden dark:bg-slate-800 dark:border-slate-700"
            >
              <div className="p-8 border-b border-brand-100 flex justify-between items-center bg-brand-50 dark:border-slate-700 dark:bg-slate-700">
                <div>
                  <h3 className="text-xl font-bold text-brand-700 tracking-tight dark:text-brand-400">{t('manualSchedule')}</h3>
                  <p className="text-slate-500 text-xs mt-1 dark:text-slate-400">{t('bypassAiDesc')}</p>
                </div>
                <button onClick={closeModal} className="p-2 hover:bg-brand-100 rounded-xl transition-all dark:hover:bg-slate-600">
                  <X size={20} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleCreatePost} className="p-8 space-y-6">
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-500 text-xs"
                  >
                    <AlertCircle size={14} />
                    {formError}
                  </motion.div>
                )}

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">{t('contentDraft')}</label>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder={t('contentPlaceholder')}
                      className="w-full h-32 bg-brand-50 border border-brand-100 rounded-xl p-4 text-brand-700 text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all resize-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">{t('platform')}</label>
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: 'TIKTOK', icon: Share2 },
                          { id: 'INSTAGRAM', icon: Instagram },
                          { id: 'TWITTER', icon: Twitter },
                          { id: 'TELEGRAM', icon: Send }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setPlatform(p.id as any)}
                            className={`p-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                              platform === p.id
                                ? 'bg-brand-50 border-brand-500 text-brand-600 dark:bg-slate-800'
                                : 'bg-white border-brand-100 text-slate-400 hover:border-brand-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            <p.icon size={16} />
                            <span className="text-[8px] font-bold">{p.id.charAt(0) + p.id.slice(1).toLowerCase()}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">{t('publishTime')}</label>
                      <input
                        required
                        type="datetime-local"
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                    </div>
                  </div>

                  {platform === 'TIKTOK' && (
                    <div>
                      <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">TikTok video</label>
                      <input
                        required
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                        className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:font-bold file:text-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">MP4, MOV, or WebM. Auto-post starts only after TikTok approves video.publish.</p>
                    </div>
                  )}
                  {platform === 'TELEGRAM' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">Telegram image or video</label>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
                          onChange={(e) => setTelegramMediaFile(e.target.files?.[0] || null)}
                          className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:font-bold file:text-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                        />
                        {telegramMediaFile && (
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Selected: {telegramMediaFile.name} ({formatFileSize(telegramMediaFile.size)})
                          </p>
                        )}
                      </div>
                      <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl flex items-start gap-2 text-sky-600 text-xs">
                        <Upload size={14} className="mt-0.5 shrink-0" />
                        <p>Telegram can post text, image, or video. If you add media, the text will be used as the caption.</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="flex-1 py-4 bg-brand-50 text-brand-700 border border-brand-100 font-bold rounded-2xl hover:bg-brand-100 transition-all dark:bg-slate-800 dark:border-slate-700 dark:text-brand-400 dark:hover:bg-slate-700"
                  >
                    {t('discard')}
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 bg-brand-700 hover:bg-brand-800 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-brand-700/20"
                  >
                    {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : (
                      <>
                        <Clock size={18} />
                        {t('scheduleBtn')}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SchedulerHub;
