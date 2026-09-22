import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Bot, Zap, Plus, Sparkles, Clock, X, Send, Instagram, Twitter, Share2, Loader2, AlertCircle, Upload, Youtube } from 'lucide-react';
import { formatImageKitUploadError } from '../../shared/imageKitError.js';
import AITrainer from './AITrainer';
import Suggestions from './Suggestions';
import Scheduler from './Scheduler';
import ActivityPulse from './ActivityPulse';
import { db, storage } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { useLanguage } from '../contexts/LanguageContext';
import { saveLocalMedia } from '../lib/localMediaStore';
import { withUploadTimeout } from '../lib/withUploadTimeout';

import { useAuth } from '../contexts/AuthContext';
import { ScheduleHandoffRequest } from '../types';
import { recordAuditEvent } from '../lib/auditClient';

type Platform = 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM';

const MB = 1024 * 1024;
const TELEGRAM_MEDIA_LIMIT_MB = 48;
const DEMO_INLINE_MEDIA_LIMIT_MB = 3;
const LOCAL_POSTS_KEY = 'demo_scheduled_posts';
const UPLOAD_TIMEOUT_MESSAGE = 'Upload is taking too long. Please check your internet connection or use a smaller video.';

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

interface SchedulerHubProps {
  handoffRequest?: ScheduleHandoffRequest | null;
  onHandoffConsumed?: (requestId: string) => void;
}

const SchedulerHub: React.FC<SchedulerHubProps> = ({ handoffRequest, onHandoffConsumed }) => {
  const { t } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [activityVersion, setActivityVersion] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const handledHandoffRef = React.useRef<string | null>(null);

  // Helper for local datetime string
  const getLocalISOString = (date: Date) => {
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime( ) - tzOffset).toISOString().slice(0, 16);
  };
  
  // Form state
  const [content, setContent] = useState('');
  // An array, not a scalar, so one post can fan out to several destinations at
  // once (e.g. TikTok + Telegram) -- each selected platform gets its own
  // scheduled_posts doc (or Telegram's own create call) sharing one groupId,
  // so the two existing cron runners (api/tiktok/publish.js,
  // api/telegram/run-scheduled.js) need no changes at all.
  const [platforms, setPlatforms] = useState<Platform[]>(['TIKTOK']);
  const togglePlatform = (id: Platform) => {
    setPlatforms((prev) => {
      if (prev.includes(id)) {
        // Always keep at least one platform selected.
        return prev.length > 1 ? prev.filter((p) => p !== id) : prev;
      }
      return [...prev, id];
    });
  };
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [telegramMediaFile, setTelegramMediaFile] = useState<File | null>(null);
  const [scheduledTime, setScheduledTime] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1);
    nextHour.setMinutes(0);
    return getLocalISOString(nextHour);
  });
  // True while a handoff's generated video/image is still being converted into
  // a File in the background — the modal opens immediately, but the media isn't
  // attached yet, so submitting during this window would silently post with no
  // media attached even though the user sees the generated content on screen.
  const [isAttachingHandoffMedia, setIsAttachingHandoffMedia] = useState(false);

  // Consumes a "schedule this" handoff from PosterGen/VideoVoice: prefills the
  // create-post form with the generated media + caption and opens the modal,
  // defaulting to Telegram since it's the only platform this app can actually
  // auto-publish to on a schedule (TikTok requires the user's own connected
  // session at publish time, so it can't be pre-scheduled from a handoff).
  React.useEffect(() => {
    if (!handoffRequest || handledHandoffRef.current === handoffRequest.id) return;
    handledHandoffRef.current = handoffRequest.id;
    const requestId = handoffRequest.id;
    const targetPlatform = handoffRequest.preferredPlatform || 'TELEGRAM';

    setIsAttachingHandoffMedia(true);
    (async () => {
      try {
        const response = await fetch(handoffRequest.mediaDataUrl);
        const blob = await response.blob();
        const mimeType = handoffRequest.kind === 'video' ? 'video/mp4' : 'image/png';
        const file = new File([blob], handoffRequest.mediaName, { type: blob.type || mimeType });
        // A newer handoff may have arrived and started its own fetch while this one
        // was in flight -- handledHandoffRef.current is always the latest request's
        // id, so if it's moved on, this (now-stale) result must not overwrite it.
        if (handledHandoffRef.current !== requestId) return;
        if (targetPlatform === 'TIKTOK' || targetPlatform === 'YOUTUBE') {
          setVideoFile(file);
          setTelegramMediaFile(null);
        } else {
          setTelegramMediaFile(file);
          setVideoFile(null);
        }
      } catch (error) {
        console.error('Could not attach the generated media to the scheduler:', error);
      } finally {
        if (handledHandoffRef.current === requestId) setIsAttachingHandoffMedia(false);
      }
    })();

    setContent(handoffRequest.caption);
    setPlatforms([targetPlatform]);
    setIsModalOpen(true);
    onHandoffConsumed?.(handoffRequest.id);
  }, [handoffRequest?.id]);

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
    return null;
  };

  // Not Telegram-specific despite the endpoint's name -- also used as a
  // fallback for TikTok/YouTube video uploads when Firebase Storage can't be
  // reached (confirmed live: a user's network could upload to ImageKit fine
  // but every Firebase Storage upload stalled at 0 bytes for 60s straight,
  // meaning the connection to firebasestorage.googleapis.com specifically
  // was the problem, not file size or general connectivity).
  const uploadMediaViaImageKit = async (file: File, idToken: string): Promise<{ mediaUrl: string; mediaType: 'photo' | 'video' }> => {
    let signatureResponse: Response;
    try {
      // Unlike doUpload() below (the actual ImageKit upload, already
      // timeout-wrapped), this same-origin call had no timeout at all -- a hung
      // response left isSubmitting stuck true forever, since the finally block
      // that resets it never runs until this await settles.
      signatureResponse = await withUploadTimeout(fetch('/api/telegram/run-scheduled?action=sign-upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`
        }
      }), UPLOAD_TIMEOUT_MESSAGE);
    } catch {
      throw new Error('Could not reach the app server to prepare the upload. Check your internet connection and try again.');
    }
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

    // Sending a multi-MB file directly to ImageKit (cross-origin, unlike the
    // same-origin calls above) is the step most exposed to a mid-upload network
    // drop, which surfaces as a bare "Failed to fetch" with no useful detail —
    // one retry plus a clearer message covers the common transient case.
    const doUpload = async () => {
      const form = new FormData();
      form.set('file', file);
      form.set('fileName', file.name || `scheduled-media-${Date.now()}`);
      form.set('publicKey', signatureData.publicKey);
      form.set('token', signatureData.token);
      form.set('expire', String(signatureData.expire));
      form.set('signature', signatureData.signature);
      form.set('folder', signatureData.folder);
      return withUploadTimeout(fetch(signatureData.uploadUrl, {
        method: 'POST',
        body: form
      }), UPLOAD_TIMEOUT_MESSAGE);
    };

    let uploadResponse: Response;
    try {
      uploadResponse = await doUpload();
    } catch (error) {
      if (error instanceof Error && /taking too long/i.test(error.message)) throw error;
      try {
        uploadResponse = await doUpload();
      } catch (retryError) {
        if (retryError instanceof Error && /taking too long/i.test(retryError.message)) throw retryError;
        throw new Error('The media upload was interrupted (network connection dropped). Check your internet connection and try again.');
      }
    }
    const uploadData = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !uploadData.url) {
      throw new Error(formatImageKitUploadError(uploadData?.message || uploadData?.error?.message || 'Media upload failed.', [signatureData.publicKey]));
    }

    return {
      mediaUrl: String(uploadData.url),
      mediaType: uploadData.resource_type === 'video' || file.type.startsWith('video/') ? 'video' : 'photo'
    };
  };

  // uploadBytes (a single-shot XHR) previously gave a large TikTok video no
  // progress feedback and only a fixed 180s wall-clock timeout -- a real
  // upload that's still actively transferring bytes on a slow connection got
  // killed at the same 180s mark as one that's genuinely stalled at 0%, with
  // nothing telling the user which case they were in. uploadBytesResumable
  // reports progress, so this only times out after real inactivity (no byte
  // progress for 60s), not merely because the file is large.
  const UPLOAD_INACTIVITY_TIMEOUT_MS = 60000;
  const uploadVideoWithProgress = (storageRef: ReturnType<typeof ref>, file: File, onProgress: (pct: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, file, { contentType: file.type });
      let lastProgressAt = Date.now();
      const stallCheck = window.setInterval(() => {
        if (Date.now() - lastProgressAt > UPLOAD_INACTIVITY_TIMEOUT_MS) {
          window.clearInterval(stallCheck);
          uploadTask.cancel();
          reject(new Error('Upload stalled with no progress for over a minute. Please check your internet connection or use a smaller video.'));
        }
      }, 5000);
      uploadTask.on(
        'state_changed',
        (snapshot) => {
          lastProgressAt = Date.now();
          onProgress(snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0);
        },
        (error) => {
          window.clearInterval(stallCheck);
          reject(error);
        },
        () => {
          window.clearInterval(stallCheck);
          resolve();
        },
      );
    });

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

  // One call per selected platform (see the fan-out loop in handleCreatePost)
  // so a combined TikTok + Telegram post shows up as two demo cards sharing
  // groupId, mirroring how the live path writes two scheduled_posts docs.
  const saveLocalSchedule = async (userId: string, scheduledDate: Date, platform: Platform, groupId: string) => {
    const postId = `${Date.now().toString()}-${platform}`;
    // Telegram can carry an image or video; TikTok and YouTube require a
    // video. Preserve the selected media for demo-mode schedule cards as well.
    const mediaFile = platform === 'TELEGRAM'
      ? (telegramMediaFile || videoFile)
      : platform === 'TIKTOK' || platform === 'YOUTUBE'
        ? videoFile
        : null;
    const mediaDbKey = mediaFile ? `${platform.toLowerCase()}-${postId}-${crypto.randomUUID()}` : null;
    if (mediaDbKey && mediaFile) {
      await saveLocalMedia(mediaDbKey, mediaFile);
    }

    const publishMode = platform === 'TELEGRAM'
      ? 'TELEGRAM_AUTO_POST_LOCAL'
      : platform === 'TIKTOK'
      ? 'TIKTOK_DIRECT_POST_LOCAL'
      : platform === 'YOUTUBE'
      ? 'YOUTUBE_STUDIO_READY_LOCAL'
      : 'PLANNED_ONLY';

    const post = {
      id: postId,
      groupId,
      content: content.trim(),
      platform,
      scheduledTime: scheduledDate.toISOString(),
      status: 'PENDING',
      userId,
      aiSuggested: false,
      videoName: videoFile?.name || null,
      mediaDbKey,
      mediaName: mediaFile?.name || null,
      mediaType: mediaFile ? (mediaFile.type.startsWith('video/') ? 'video' : 'photo') : null,
      publishMode,
      localOnly: true,
      createdAt: new Date().toISOString()
    };

    saveCompactLocalPosts([post, ...getCompactLocalPosts()]);
    window.dispatchEvent(new Event('demo-scheduled-posts-updated'));
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (isAttachingHandoffMedia) {
      setFormError('Still attaching the generated media — please wait a moment and try again.');
      return;
    }

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    const requiresVideo = platforms.includes('TIKTOK') || platforms.includes('YOUTUBE');
    // Telegram can post text-only or media-only, so it's the one case where a
    // blank caption is fine -- but only when it's the *sole* destination and
    // has its own media, since a combined post still needs a caption/title
    // for the other platform(s) it's also going to.
    const telegramOnlyWithMedia = platforms.length === 1 && platforms[0] === 'TELEGRAM' && !!telegramMediaFile;
    if ((!content.trim() && !telegramOnlyWithMedia) || !scheduledTime || !userToUse || (requiresVideo && !videoFile)) {
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

    // If Telegram is one of several destinations and no separate Telegram
    // media was chosen, the shared video (required for TikTok/YouTube) is
    // reused for Telegram too rather than asking the user to upload it twice.
    const effectiveTelegramMedia = telegramMediaFile || (platforms.includes('TELEGRAM') ? videoFile : null);
    const mediaError = platforms.includes('TELEGRAM') ? validateTelegramMedia(effectiveTelegramMedia, isDemoMode) : null;
    if (mediaError) {
      setFormError(mediaError);
      return;
    }

    setIsSubmitting(true);
    const groupId = crypto.randomUUID();

    if (isDemoMode) {
      try {
        for (const platform of platforms) {
          await saveLocalSchedule('demo-user', scheduledDate, platform, groupId);
        }
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
      if (!user) throw new Error('Please sign in first.');
      const idToken = await user.getIdToken();

      // Uploaded once and reused across every selected platform that needs
      // it, rather than once per platform.
      let videoUrl = '';
      if (requiresVideo && videoFile) {
        const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageRef = ref(storage, `scheduled-videos/${userToUse.uid}/${Date.now()}-${safeName}`);
        setUploadProgress(0);
        try {
          await uploadVideoWithProgress(storageRef, videoFile, setUploadProgress);
          videoUrl = await getDownloadURL(storageRef);
        } catch (storageError) {
          // Firebase Storage can be unreachable on some networks even when
          // the same connection uploads to ImageKit fine (confirmed live) --
          // fall back rather than failing the whole post on a storage-
          // provider-specific issue.
          console.error('Firebase Storage upload failed, falling back to ImageKit:', storageError);
          const uploaded = await uploadMediaViaImageKit(videoFile, idToken);
          videoUrl = uploaded.mediaUrl;
        } finally {
          setUploadProgress(null);
        }
      }

      let telegramMediaUrl = '';
      let telegramMediaType: 'photo' | 'video' | null = null;
      if (platforms.includes('TELEGRAM') && effectiveTelegramMedia) {
        // Reuse the just-uploaded video URL instead of uploading the same
        // file to ImageKit a second time when TikTok/YouTube already has it.
        if (effectiveTelegramMedia === videoFile && videoUrl) {
          telegramMediaUrl = videoUrl;
          telegramMediaType = 'video';
        } else {
          const uploaded = await uploadMediaViaImageKit(effectiveTelegramMedia, idToken);
          telegramMediaUrl = uploaded.mediaUrl;
          telegramMediaType = uploaded.mediaType;
        }
      }

      const failures: string[] = [];
      for (const platform of platforms) {
        try {
          if (platform === 'TELEGRAM') {
            let response: Response;
            try {
              response = await withUploadTimeout(fetch('/api/telegram/run-scheduled?action=create', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                  content: content.trim(),
                  scheduledTime: scheduledDate.toISOString(),
                  mediaUrl: telegramMediaUrl,
                  mediaName: effectiveTelegramMedia?.name || null,
                  mediaType: telegramMediaType,
                  groupId,
                })
              }), UPLOAD_TIMEOUT_MESSAGE);
            } catch {
              throw new Error('network error reaching the scheduling service');
            }
            const responseText = await response.text();
            let data: any = {};
            try {
              data = responseText ? JSON.parse(responseText) : {};
            } catch {
              throw new Error(`scheduling service returned HTTP ${response.status} instead of JSON`);
            }
            if (!response.ok || !data.ok) {
              throw new Error(data.error || 'could not schedule this Telegram post');
            }
            continue;
          }

          await addDoc(collection(db, 'scheduled_posts'), {
            content: content.trim(),
            platform,
            groupId,
            scheduledTime: scheduledDate.toISOString(),
            status: 'PENDING',
            userId: userToUse.uid,
            aiSuggested: false,
            videoUrl: platform === 'TIKTOK' || platform === 'YOUTUBE' ? videoUrl : '',
            videoName: videoFile?.name || null,
            mediaUrl: '',
            mediaName: null,
            mediaType: null,
            publishMode: platform === 'TIKTOK'
              ? 'TIKTOK_DIRECT_POST'
              : platform === 'YOUTUBE'
                ? 'YOUTUBE_STUDIO_READY'
                : 'PLANNED_ONLY',
            createdAt: serverTimestamp()
          });
          void recordAuditEvent('scheduled_post_created', {
            platform,
            scheduledTime: scheduledDate.toISOString(),
            hasMedia: Boolean(videoUrl),
          });
        } catch (platformError) {
          const message = platformError instanceof Error ? platformError.message : 'unknown error';
          failures.push(`${platform}: ${message}`);
        }
      }

      if (failures.length === platforms.length) {
        throw new Error(failures.join('; '));
      }

      resetFormAfterSchedule();
      if (failures.length) {
        setFormError(`Scheduled for ${platforms.length - failures.length}/${platforms.length} platform(s). Failed: ${failures.join('; ')}`);
      }
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
    // An in-flight submit that's stuck (or just slow) shouldn't keep the button
    // permanently disabled/spinning the next time this modal opens -- if the
    // stale request eventually does resolve after this, its own finally block
    // harmlessly resets isSubmitting again on an already-closed modal.
    setIsSubmitting(false);
    setUploadProgress(null);
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
                    className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/60 rounded-lg flex items-center gap-2 text-red-500 dark:text-red-300 text-xs"
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
                      <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">{t('platform')} (select one or more)</label>
                      <div className="grid grid-cols-5 gap-2">
                        {[
                          { id: 'TIKTOK', icon: Share2 },
                          { id: 'YOUTUBE', icon: Youtube },
                          { id: 'INSTAGRAM', icon: Instagram },
                          { id: 'TWITTER', icon: Twitter },
                          { id: 'TELEGRAM', icon: Send }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => togglePlatform(p.id as Platform)}
                            className={`p-3 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                              platforms.includes(p.id as Platform)
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

                  {(platforms.includes('TIKTOK') || platforms.includes('YOUTUBE')) && (
                    <div>
                      <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">
                        {platforms.includes('YOUTUBE') && !platforms.includes('TIKTOK') ? 'YouTube landscape video (16:9)' : 'TikTok portrait video (9:16)'}
                      </label>
                      <input
                        required
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                        className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:font-bold file:text-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {platforms.includes('YOUTUBE') && !platforms.includes('TIKTOK')
                          ? 'Horizontal 16:9 MP4, MOV, or WebM. This prepares the video and metadata for upload in YouTube Studio.'
                          : 'MP4, MOV, or WebM. Auto-post starts only after TikTok approves video.publish.'}
                        {platforms.includes('TELEGRAM') && !telegramMediaFile && ' This same video is also used for Telegram unless you attach a different file below.'}
                      </p>
                    </div>
                  )}
                  {platforms.includes('TELEGRAM') && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">
                          Telegram image or video{(platforms.includes('TIKTOK') || platforms.includes('YOUTUBE')) ? ' (optional -- reuses the video above if left blank)' : ''}
                        </label>
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
                      <div className="p-3 bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800/60 rounded-xl flex items-start gap-2 text-sky-600 dark:text-sky-300 text-xs">
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
                    disabled={isSubmitting || isAttachingHandoffMedia}
                    className="flex-1 py-4 bg-brand-700 hover:bg-brand-800 text-white font-bold rounded-2xl transition-all flex items-center justify-center gap-2 shadow-xl shadow-brand-700/20 disabled:opacity-60"
                  >
                    {isSubmitting || isAttachingHandoffMedia ? (
                      <>
                        <Loader2 className="animate-spin" size={18} />
                        {uploadProgress !== null && <span>{uploadProgress}%</span>}
                      </>
                    ) : (
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
