import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Bot, Zap, Plus, Sparkles, Clock, X, Send, Share2, Loader2, AlertCircle, Upload, Youtube, Facebook } from 'lucide-react';
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
import { requireTikTokAutomationConnection, requireYouTubeAutomationConnection } from '../lib/tiktokConnection';

import { useAuth } from '../contexts/AuthContext';
import { ScheduleHandoffRequest } from '../types';
import { recordAuditEvent } from '../lib/auditClient';

type Platform = 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM' | 'FACEBOOK';

const MB = 1024 * 1024;
const TELEGRAM_MEDIA_LIMIT_MB = 47;
const DEMO_INLINE_MEDIA_LIMIT_MB = 3;
const DEFAULT_HASHTAGS = '#foryou #foodies #aicafe';
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
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const [activityVersion, setActivityVersion] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const pendingGroupIdRef = React.useRef<string | null>(null);
  const submittingRef = React.useRef(false);
  const handledHandoffRef = React.useRef<string | null>(null);

  // Helper for local datetime string
  const getLocalISOString = (date: Date) => {
    const tzOffset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime( ) - tzOffset).toISOString().slice(0, 16);
  };
  
  // Form state
  const [content, setContent] = useState(DEFAULT_HASHTAGS);
  // Per-platform caption override -- when empty/unset for a platform, that
  // platform's post falls back to the shared Content Draft above. Each
  // platform has its own caption conventions (TikTok short + hashtags,
  // YouTube title/description style, Telegram more informational), so
  // reusing one shared caption for every destination in a combined post
  // read oddly on at least one of them.
  const [platformCaptions, setPlatformCaptions] = useState<Partial<Record<Platform, string>>>({});
  const [customizingCaptionFor, setCustomizingCaptionFor] = useState<Partial<Record<Platform, boolean>>>({});
  const captionFor = (platform: Platform) => (platformCaptions[platform]?.trim() || content.trim());
  // An array, not a scalar, so one post can fan out to several destinations at
  // once (e.g. TikTok + Telegram) -- each selected platform gets its own
  // scheduled_posts doc (or Telegram's own create call) sharing one groupId,
  // so the two existing cron runners (api/tiktok/publish.js,
  // api/telegram/run-scheduled.js) need no changes at all.
  const [platforms, setPlatforms] = useState<Platform[]>(['TIKTOK']);
  const [completedPlatforms, setCompletedPlatforms] = useState<Platform[]>([]);
  const [tiktokDeliveryMode, setTikTokDeliveryMode] = useState<'inbox' | 'direct'>('inbox');
  const togglePlatform = (id: Platform) => {
    if (completedPlatforms.includes(id)) return;
    setPlatforms((prev) => {
      if (prev.includes(id)) {
        // Always keep at least one platform selected.
        return prev.length > 1 ? prev.filter((p) => p !== id) : prev;
      }
      return [...prev, id];
    });
  };
  // Only worth showing once there's more than one destination -- with a
  // single platform selected, the shared Content Draft already is that
  // platform's caption.
  const renderCaptionOverride = (platform: Platform, label: string) => {
    if (platforms.length <= 1) return null;
    return customizingCaptionFor[platform] ? (
      <div className="mt-3">
        <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">
          {label} caption (overrides the content draft above for this platform only)
        </label>
        <textarea
          rows={3}
          value={platformCaptions[platform] ?? content}
          onChange={(e) => setPlatformCaptions((prev) => ({ ...prev, [platform]: e.target.value }))}
          className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => {
            setCustomizingCaptionFor((prev) => ({ ...prev, [platform]: false }));
            setPlatformCaptions((prev) => {
              const next = { ...prev };
              delete next[platform];
              return next;
            });
          }}
          className="mt-1 text-xs font-bold text-slate-400 hover:underline"
        >
          Use the shared content draft instead
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={() => setCustomizingCaptionFor((prev) => ({ ...prev, [platform]: true }))}
        className="mt-3 text-xs font-bold text-sky-600 hover:underline dark:text-sky-400"
      >
        + Use a different caption for {label}
      </button>
    );
  };
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [telegramMediaFile, setTelegramMediaFile] = useState<File | null>(null);
  const [showTelegramFileInput, setShowTelegramFileInput] = useState(false);
  // Every platform whose auto-post reuses the one shared "video above" field
  // (Telegram also reuses it, but through its own optional field below).
  const hasSharedVideoField = platforms.includes('TIKTOK') || platforms.includes('YOUTUBE') || platforms.includes('FACEBOOK');
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
  const [youtubeJustConnected, setYoutubeJustConnected] = useState(false);
  const [isConnectingYouTube, setIsConnectingYouTube] = useState(false);
  const [tiktokJustConnected, setTiktokJustConnected] = useState(false);
  const [isConnectingTikTok, setIsConnectingTikTok] = useState(false);
  const [isConnectingFacebook, setIsConnectingFacebook] = useState(false);
  const [facebookPages, setFacebookPages] = useState<{ id: string; name: string }[]>([]);
  const [facebookPageId, setFacebookPageId] = useState('');

  const loadFacebookPages = async () => {
    if (!user) return;
    const response = await fetch('/api/tiktok/me?action=facebookAutomation', {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not check Facebook Pages.');
    setFacebookPages(data.pages || []);
    setFacebookPageId(data.selectedPageId || '');
    return data;
  };

  useEffect(() => {
    if (!user || !isModalOpen || !platforms.includes('FACEBOOK')) return;
    loadFacebookPages().catch(error => setFormError(error.message));
  }, [user?.uid, isModalOpen, platforms.includes('FACEBOOK')]);

  // The OAuth callback posts this message back before closing its popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'YOUTUBE_AUTH_SUCCESS') setYoutubeJustConnected(true);
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') setTiktokJustConnected(true);
      if (event.data?.type === 'FACEBOOK_AUTH_SUCCESS') loadFacebookPages().catch(error => setFormError(error.message));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [user]);

  useEffect(() => { setTiktokJustConnected(false); setYoutubeJustConnected(false); }, [user?.uid]);

  const connectYouTube = async () => {
    if (!user) {
      setFormError('Sign in before connecting YouTube.');
      return;
    }
    const popup = window.open('about:blank', 'youtubeAuth', 'width=600,height=700');
    if (!popup) {
      setFormError('Allow popups to connect YouTube.');
      return;
    }
    setIsConnectingYouTube(true);
    setFormError(null);
    try {
      const response = await fetch('/api/auth/tiktok?provider=youtube', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not connect YouTube.');
      popup.location.href = data.url;
    } catch (error) {
      popup.close();
      setFormError(error instanceof Error ? error.message : 'Could not connect YouTube.');
    } finally {
      setIsConnectingYouTube(false);
    }
  };

  const connectTikTok = async () => {
    if (!user) {
      setFormError('Sign in before connecting TikTok.');
      return;
    }
    const popup = window.open('about:blank', 'tiktokAuth', 'width=600,height=700');
    if (!popup) {
      setFormError('Allow popups to connect TikTok.');
      return;
    }
    setIsConnectingTikTok(true);
    setFormError(null);
    try {
      const response = await fetch('/api/auth/tiktok', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not connect TikTok.');
      popup.location.href = data.url;
    } catch (error) {
      popup.close();
      setFormError(error instanceof Error ? error.message : 'Could not connect TikTok.');
    } finally {
      setIsConnectingTikTok(false);
    }
  };

  const connectFacebook = async () => {
    if (!user) { setFormError('Sign in before connecting Facebook.'); return; }
    const popup = window.open('about:blank', 'facebookAuth', 'width=600,height=700');
    if (!popup) { setFormError('Allow popups to connect Facebook.'); return; }
    setIsConnectingFacebook(true);
    setFormError(null);
    try {
      const response = await fetch('/api/auth/tiktok?provider=facebook', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || 'Could not connect Facebook.');
      popup.location.href = data.url;
    } catch (error) {
      popup.close();
      setFormError(error instanceof Error ? error.message : 'Could not connect Facebook.');
    } finally { setIsConnectingFacebook(false); }
  };

  // Consumes a "schedule this" handoff from PosterGen/VideoVoice: prefills the
  // create-post form with the generated media + caption and opens the modal,
  // defaulting to Telegram since it's the only platform this app can actually
  // auto-publish to on a schedule (TikTok requires the user's own connected
  // session at publish time, so it can't be pre-scheduled from a handoff).
  React.useEffect(() => {
    if (!handoffRequest || handledHandoffRef.current === handoffRequest.id) return;
    handledHandoffRef.current = handoffRequest.id;
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
    const requestId = handoffRequest.id;
    const targetPlatform = handoffRequest.preferredPlatform || 'TELEGRAM';

    setIsAttachingHandoffMedia(true);
    (async () => {
      try {
        // Generated media is hosted remotely (ImageKit) -- <video>/<img>
        // playback and a plain download link both work cross-origin fine,
        // but reading the response body here (to build a File for the
        // TikTok/YouTube upload field) needs CORS, which ImageKit's
        // delivery domain doesn't grant. Route remote URLs through our own
        // same-origin proxy instead; a data: URL (no remote fetch involved)
        // is already same-origin and can be fetched directly.
        const isRemoteUrl = /^https?:\/\//i.test(handoffRequest.mediaDataUrl);
        const fetchUrl = isRemoteUrl ? `/api/mediaProxy?url=${encodeURIComponent(handoffRequest.mediaDataUrl)}` : handoffRequest.mediaDataUrl;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Could not fetch the generated media (status ${response.status}).`);
        const blob = await response.blob();
        const mimeType = handoffRequest.kind === 'video' ? 'video/mp4' : 'image/png';
        const file = new File([blob], handoffRequest.mediaName, { type: blob.type || mimeType });
        // A newer handoff may have arrived and started its own fetch while this one
        // was in flight -- handledHandoffRef.current is always the latest request's
        // id, so if it's moved on, this (now-stale) result must not overwrite it.
        if (handledHandoffRef.current !== requestId) return;
        if (handoffRequest.kind === 'video') {
          // A generated video is valid media for either slot -- TikTok/YouTube
          // need it in the dedicated video field, Telegram can send the same
          // clip as its media. Populate both so if the user adds TikTok/YouTube
          // as a platform after a Telegram-preferring handoff lands (there is
          // no video-specific preferredPlatform from VideoVoice's own Schedule
          // button), that field isn't stuck on "No file chosen" with no way to
          // attach the already-generated clip -- requiresVideo's submit guard
          // (below) was blocking scheduling entirely in exactly that case.
          setVideoFile(file);
          setTelegramMediaFile(file);
        } else if (targetPlatform === 'TIKTOK' || targetPlatform === 'YOUTUBE' || targetPlatform === 'FACEBOOK') {
          setVideoFile(file);
          setTelegramMediaFile(null);
        } else {
          setTelegramMediaFile(file);
          setVideoFile(null);
        }
      } catch (error) {
        // A failed fetch here (CORS on the remote hosting URL, a dropped
        // connection, etc.) previously only logged to the console -- the
        // video/TikTok file field was left showing "No file chosen" with a
        // "Please select a file" validation error and zero indication why,
        // or any way to recover besides manually downloading and
        // re-uploading the clip the user had just watched moments earlier.
        console.error('Could not attach the generated media to the scheduler:', error);
        if (handledHandoffRef.current === requestId) {
          setFormError(language === 'km'
            ? 'មិនអាចភ្ជាប់វីដេអូ/រូបភាពដែលបានបង្កើតដោយស្វ័យប្រវត្តិទេ។ សូមប្រើប៊ូតុង "Choose file" ខាងក្រោម ដើម្បីទាញយក (Download) ឯកសារដែលបានបង្កើត រួចបញ្ចូលវាដោយដៃ។'
            : 'Could not automatically attach the generated video/image. Please use the "Choose file" button below to upload it manually (download it first if needed).');
        }
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
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
    setIsModalOpen(false);
    setContent(DEFAULT_HASHTAGS);
    setPlatformCaptions({});
    setCustomizingCaptionFor({});
    setVideoFile(null);
    setTelegramMediaFile(null);
    setShowTelegramFileInput(false);

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
      : platform === 'TIKTOK' || platform === 'YOUTUBE' || platform === 'FACEBOOK'
        ? videoFile
        : null;
    const mediaDbKey = mediaFile ? `${platform.toLowerCase()}-${postId}-${crypto.randomUUID()}` : null;
    if (mediaDbKey && mediaFile) {
      await saveLocalMedia(mediaDbKey, mediaFile);
    }

    const publishMode = platform === 'TELEGRAM'
      ? 'TELEGRAM_AUTO_POST_LOCAL'
      : platform === 'TIKTOK'
      ? (tiktokDeliveryMode === 'inbox' ? 'TIKTOK_UPLOAD_DRAFT_LOCAL' : 'TIKTOK_DIRECT_POST_LOCAL')
      : platform === 'YOUTUBE'
      ? 'YOUTUBE_STUDIO_READY_LOCAL'
      : platform === 'FACEBOOK'
      ? 'FACEBOOK_REEL_PREVIEW_LOCAL'
      : 'PLANNED_ONLY';

    const post = {
      id: postId,
      groupId,
      content: captionFor(platform),
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
    if (submittingRef.current) return;
    setFormError(null);

    if (platforms.includes('TIKTOK') && tiktokDeliveryMode === 'direct') {
      setFormError('Scheduled Direct Post needs TikTok creator settings and explicit posting consent. Use Upload to TikTok until that flow is available.');
      return;
    }

    if (isAttachingHandoffMedia) {
      setFormError('Still attaching the generated media — please wait a moment and try again.');
      return;
    }

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    const requiresVideo = platforms.includes('TIKTOK') || platforms.includes('YOUTUBE') || platforms.includes('FACEBOOK');
    // Telegram can post text-only or media-only, so it's the one case where a
    // blank caption is fine -- but only when it's the *sole* destination and
    // has its own media, since a combined post still needs a caption/title
    // for the other platform(s) it's also going to.
    const telegramOnlyWithMedia = platforms.length === 1 && platforms[0] === 'TELEGRAM' && !!(telegramMediaFile || videoFile);
    // A platform is fine with no caption only in the telegramOnlyWithMedia
    // case above -- every other selected platform needs *some* resolved
    // caption, whether that's its own override or the shared draft.
    const missingCaption = platforms.some((p) => !captionFor(p) && !(p === 'TELEGRAM' && telegramOnlyWithMedia));
    if (missingCaption || !scheduledTime || !userToUse || (requiresVideo && !videoFile)) {
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

    submittingRef.current = true;
    setIsSubmitting(true);
    const groupId = pendingGroupIdRef.current || crypto.randomUUID();
    pendingGroupIdRef.current = groupId;

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
        submittingRef.current = false;
        setIsSubmitting(false);
      }
      return;
    }

    try {
      if (!user) throw new Error('Please sign in first.');
      const idToken = await user.getIdToken();
      let selectedFacebookPageId = facebookPageId;
      await Promise.all([
        ...(platforms.includes('TIKTOK') ? [requireTikTokAutomationConnection(user)] : []),
        ...(platforms.includes('YOUTUBE') ? [requireYouTubeAutomationConnection(user)] : []),
        ...(platforms.includes('FACEBOOK') ? [loadFacebookPages().then(data => {
          if (!data?.connected || !data.selectedPageId) throw new Error('Connect and choose a Facebook Page before scheduling.');
          selectedFacebookPageId = data.pages.some((page: { id: string }) => page.id === facebookPageId) ? facebookPageId : data.selectedPageId;
        })] : []),
      ]);

      // TikTok/YouTube use one video upload. Telegram also needs a copy in
      // ImageKit when that upload went to Firebase Storage.
      let videoUrl = '';
      let videoImageKitUrl = '';
      if (requiresVideo && videoFile) {
        if (platforms.includes('TELEGRAM') && effectiveTelegramMedia === videoFile) {
          // One hosted video works for both Telegram and TikTok/YouTube. Avoid
          // uploading the same large file to Firebase and then ImageKit again.
          const uploaded = await uploadMediaViaImageKit(videoFile, idToken);
          videoUrl = uploaded.mediaUrl;
          videoImageKitUrl = uploaded.mediaUrl;
        } else {
          const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
          const storageRef = ref(storage, `scheduled-videos/${userToUse.uid}/${Date.now()}-${safeName}`);
          setUploadProgress(0);
          try {
            await uploadVideoWithProgress(storageRef, videoFile, setUploadProgress);
            videoUrl = await getDownloadURL(storageRef);
          } catch (storageError) {
            console.error('Firebase Storage upload failed, falling back to ImageKit:', storageError);
            const uploaded = await uploadMediaViaImageKit(videoFile, idToken);
            videoUrl = uploaded.mediaUrl;
            videoImageKitUrl = uploaded.mediaUrl;
          } finally {
            setUploadProgress(null);
          }
        }
      }

      let telegramMediaUrl = '';
      let telegramMediaType: 'photo' | 'video' | null = null;
      if (platforms.includes('TELEGRAM') && effectiveTelegramMedia) {
        // Telegram scheduling accepts ImageKit media. Firebase download URLs
        // used for TikTok/YouTube cannot be passed to that endpoint.
        if (effectiveTelegramMedia === videoFile && videoImageKitUrl) {
          telegramMediaUrl = videoImageKitUrl;
          telegramMediaType = 'video';
        } else {
          const uploaded = await uploadMediaViaImageKit(effectiveTelegramMedia, idToken);
          telegramMediaUrl = uploaded.mediaUrl;
          telegramMediaType = uploaded.mediaType;
        }
      }

      const failures: string[] = [];
      const failedPlatforms: Platform[] = [];
      const deliveryWarnings: string[] = [];
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
                  content: captionFor(platform),
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

          const scheduledDocRef = await addDoc(collection(db, 'scheduled_posts'), {
            content: captionFor(platform),
            platform,
            groupId,
            scheduledTime: scheduledDate.toISOString(),
            status: 'PENDING',
            userId: userToUse.uid,
            aiSuggested: false,
            videoUrl: ['TIKTOK', 'YOUTUBE', 'FACEBOOK'].includes(platform) ? videoUrl : '',
            videoName: videoFile?.name || null,
            ...(platform === 'FACEBOOK' ? { facebookPageId: selectedFacebookPageId } : {}),
            mediaUrl: '',
            mediaName: null,
            mediaType: null,
            publishMode: platform === 'TIKTOK'
              ? (tiktokDeliveryMode === 'inbox' ? 'TIKTOK_UPLOAD_DRAFT' : 'TIKTOK_DIRECT_POST')
              : platform === 'YOUTUBE'
                ? 'YOUTUBE_AUTO_POST'
                : platform === 'FACEBOOK' ? 'FACEBOOK_REEL_AUTO_POST' : 'PLANNED_ONLY',
            createdAt: serverTimestamp()
          });
          void recordAuditEvent('scheduled_post_created', {
            platform,
            scheduledTime: scheduledDate.toISOString(),
            hasMedia: Boolean(videoUrl),
          });
          if (platform === 'TIKTOK' || platform === 'YOUTUBE' || platform === 'FACEBOOK') {
            // Await the precise callback before reporting success. A serverless
            // response can stop an unawaited fetch, leaving only the slower
            // periodic poller. The Firestore post remains scheduled if QStash
            // fails, so show a delivery warning instead of failing the post.
            try {
              const queueResponse = await fetch('/api/tiktok/publish?action=scheduleQstash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
                body: JSON.stringify({ postId: scheduledDocRef.id, scheduledTime: scheduledDate.toISOString() }),
              });
              const queueResult = await queueResponse.json().catch(() => ({}));
              if (!queueResponse.ok || queueResult.preciseDeliveryQueued !== true) {
                deliveryWarnings.push(`${platform} was saved, but exact-time delivery could not be queued. The backup scheduler will retry it.`);
              }
            } catch (qstashError) {
              console.error(`Failed to enqueue precise ${platform} delivery:`, qstashError);
              deliveryWarnings.push(`${platform} was saved, but exact-time delivery could not be queued. The backup scheduler will retry it.`);
            }
          }
        } catch (platformError) {
          const message = platformError instanceof Error ? platformError.message : 'unknown error';
          failedPlatforms.push(platform);
          failures.push(`${platform}: ${message}`);
        }
      }

      if (failures.length) {
        // Keep the media and original group ID for the failed destinations.
        // Successfully saved platforms leave the selection so a retry cannot
        // create duplicate posts for them.
        setPlatforms(failedPlatforms);
        setCompletedPlatforms((current) => [...new Set([...current, ...platforms.filter((platform) => !failedPlatforms.includes(platform))])]);
        setFormError(`Scheduled for ${platforms.length - failures.length}/${platforms.length} platform(s). Retry the remaining selection: ${failures.join('; ')}`);
        if (deliveryWarnings.length) setScheduleNotice(deliveryWarnings.join(' '));
        return;
      }

      resetFormAfterSchedule();
      setFormError(null);
      setScheduleNotice(deliveryWarnings.length ? deliveryWarnings.join(' ') : 'Scheduled successfully.');
    } catch (err) {
      console.error('Error creating post:', err);
      const message = err instanceof Error ? err.message : t('failedSavePostErr');
      setFormError(`Failed to save post: ${message}`);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const closeModal = () => {
    if (submittingRef.current) return;
    setIsModalOpen(false);
    setFormError(null);
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
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
            onClick={() => { setScheduleNotice(null); setIsModalOpen(true); }}
            className="px-6 py-3 bg-brand-700 hover:bg-brand-800 text-white rounded-2xl font-bold text-sm shadow-xl shadow-brand-700/20 flex items-center gap-2 transition-transform"
          >
            <Plus size={18} />
            {t('scheduleBtn')}
          </motion.button>
        </div>
      </header>

      {scheduleNotice && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {scheduleNotice}
        </div>
      )}

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
              role="dialog"
              aria-modal="true"
              aria-labelledby="manual-schedule-title"
              className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl border border-brand-100 bg-white shadow-2xl touch-pan-y dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="p-8 border-b border-brand-100 flex justify-between items-center bg-brand-50 dark:border-slate-700 dark:bg-slate-700">
                <div>
                  <h3 id="manual-schedule-title" className="text-xl font-bold text-brand-700 tracking-tight dark:text-brand-400">{t('manualSchedule')}</h3>
                  <p className="text-slate-500 text-xs mt-1 dark:text-slate-400">{t('bypassAiDesc')}</p>
                </div>
                <button onClick={closeModal} disabled={isSubmitting} className="p-2 hover:bg-brand-100 rounded-xl transition-all disabled:opacity-50 dark:hover:bg-slate-600">
                  <X size={20} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleCreatePost} className="p-8 space-y-6">
                <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {language === 'km'
                    ? 'ជ្រើសរើសកន្លែងផ្សាយច្រើន កំណត់ពេលម្តង ហើយប្រើវីដេអូតែមួយសម្រាប់កន្លែងដែលបានជ្រើស។ TikTok នឹងផ្ញើទៅ inbox ដើម្បីឱ្យអ្នកបញ្ចប់ការផ្សាយក្នុង TikTok។'
                    : 'Select destinations and one publish time. The same video is reused for each selected destination. TikTok sends it to your inbox for final publishing in TikTok.'}
                </p>
                {isDemoMode && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    {language === 'km'
                      ? 'Demo Mode រក្សាទុកការកំណត់នៅក្នុង browser នេះប៉ុណ្ណោះ។ សូមចូលគណនី ដើម្បីផ្សាយទៅកន្លែងដែលបានជ្រើស។'
                      : 'Demo Mode saves schedules in this browser only. Sign in to publish to the selected destinations.'}
                  </p>
                )}
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
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { id: 'TIKTOK', icon: Share2 },
                          { id: 'YOUTUBE', icon: Youtube },
                          { id: 'TELEGRAM', icon: Send },
                          { id: 'FACEBOOK', icon: Facebook }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={completedPlatforms.includes(p.id as Platform)}
                            onClick={() => togglePlatform(p.id as Platform)}
                            className={`p-3 rounded-xl border flex flex-col items-center gap-1 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                              platforms.includes(p.id as Platform)
                                ? 'bg-brand-50 border-brand-500 text-brand-600 dark:bg-slate-800'
                                : 'bg-white border-brand-100 text-slate-400 hover:border-brand-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            <p.icon size={16} />
                            <span className="text-[8px] font-bold">{p.id.charAt(0) + p.id.slice(1).toLowerCase()}</span>
                            {completedPlatforms.includes(p.id as Platform) && <span className="text-[8px]">{language === 'km' ? 'បានកំណត់' : 'Saved'}</span>}
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

                  {hasSharedVideoField && (
                    <div>
                      <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">
                        {platforms.includes('YOUTUBE') && !platforms.includes('TIKTOK')
                          ? 'YouTube landscape video (16:9)'
                          : platforms.includes('TIKTOK')
                            ? 'TikTok portrait video (9:16)'
                            : 'Video'}
                      </label>
                      <input
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm"
                        onChange={(e) => {
                          const nextFile = e.target.files?.[0] || null;
                          // A generated handoff initially fills both slots with
                          // the same File. Replacing it must update Telegram too;
                          // an explicitly different Telegram file stays intact.
                          setTelegramMediaFile((current) => current === videoFile ? null : current);
                          setVideoFile(nextFile);
                        }}
                        className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-2 file:font-bold file:text-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                      {videoFile && (
                        <p className="mt-2 text-xs font-semibold text-brand-700 dark:text-brand-300">
                          {language === 'km' ? 'វីដេអូរួម៖ ' : 'Shared video: '}{videoFile.name} ({formatFileSize(videoFile.size)})
                        </p>
                      )}
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {platforms.includes('YOUTUBE') && !platforms.includes('TIKTOK')
                          ? 'Horizontal 16:9 MP4, MOV, or WebM. Uploads automatically to your connected YouTube channel at the scheduled time.'
                          : platforms.includes('TIKTOK') && platforms.includes('YOUTUBE')
                            ? 'Use a portrait 9:16 video for TikTok and YouTube Shorts. MP4, MOV, or WebM.'
                          : 'MP4, MOV, or WebM.'}
                        {platforms.includes('TELEGRAM') && !telegramMediaFile && ' This same video is also used for Telegram unless you attach a different file below.'}
                      </p>
                    </div>
                  )}
                  {platforms.includes('TIKTOK') && (
                    <div>
                      {!isDemoMode && (
                        <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-300">
                          <p>{tiktokJustConnected
                            ? (language === 'km' ? 'បានភ្ជាប់ TikTok របស់អ្នករួច។' : 'Your TikTok account is connected.')
                            : (language === 'km' ? 'ការផុសតាមកាលវិភាគត្រូវការភ្ជាប់ TikTok ផ្ទាល់ខ្លួនរបស់អ្នក។' : 'Scheduled publishing requires your own TikTok connection.')}</p>
                          <button type="button" onClick={connectTikTok} disabled={isConnectingTikTok} className="mt-2 rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                            {isConnectingTikTok ? 'Connecting...' : (language === 'km' ? 'ភ្ជាប់ TikTok' : 'Connect TikTok')}
                          </button>
                        </div>
                      )}
                      <label htmlFor="tiktok-delivery-mode" className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">TikTok delivery</label>
                      <select
                        id="tiktok-delivery-mode"
                        value={tiktokDeliveryMode}
                        onChange={(event) => setTikTokDeliveryMode(event.target.value as 'inbox' | 'direct')}
                        className="w-full rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm text-brand-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="inbox">Upload to TikTok — finish posting in TikTok</option>
                        <option value="direct" disabled>Scheduled Direct Post — pending TikTok review and post settings</option>
                      </select>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {tiktokDeliveryMode === 'inbox'
                          ? 'At the scheduled time, the video goes to your TikTok inbox. Open the notification in TikTok to review and publish it; the caption must be added there.'
                          : 'Scheduled Direct Post is unavailable until creator settings and consent are added. Choose Upload to TikTok.'}
                      </p>
                      {renderCaptionOverride('TIKTOK', 'TikTok')}
                    </div>
                  )}
                  {platforms.includes('YOUTUBE') && (
                    <div>
                      <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800/60 rounded-xl flex items-start justify-between gap-2 text-red-600 dark:text-red-300 text-xs">
                        <div className="flex items-start gap-2">
                          <Youtube size={14} className="mt-0.5 shrink-0" />
                          <p>{youtubeJustConnected ? 'YouTube connected! ' : ''}Uploads automatically to your connected YouTube channel at the scheduled time -- no manual step needed.</p>
                        </div>
                        <button
                          type="button"
                          onClick={connectYouTube}
                          disabled={isConnectingYouTube}
                          className="shrink-0 rounded-lg bg-red-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-red-700"
                        >
                          {isConnectingYouTube ? 'Connecting…' : 'Connect YouTube'}
                        </button>
                      </div>
                      {renderCaptionOverride('YOUTUBE', 'YouTube')}
                    </div>
                  )}
                  {platforms.includes('FACEBOOK') && (
                    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                      <p>Facebook Page Reel: portrait 9:16 video, 4–60 seconds. Publishes automatically to the selected Page.</p>
                      <button type="button" onClick={connectFacebook} disabled={isConnectingFacebook || isDemoMode} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                        {isConnectingFacebook ? 'Connecting…' : 'Connect Facebook Page'}
                      </button>
                      {facebookPages.length > 0 && (
                        <label className="block font-semibold">Publish to Page
                          <select value={facebookPageId} onChange={async event => {
                            const pageId = event.target.value;
                            setFacebookPageId(pageId);
                            if (!user) return;
                            try {
                              const response = await fetch('/api/tiktok/me?action=selectFacebookPage', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
                                body: JSON.stringify({ pageId }),
                              });
                              const data = await response.json().catch(() => ({}));
                              if (!response.ok) throw new Error(data.error || 'Could not select Facebook Page.');
                            } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not select Facebook Page.'); }
                          }} className="mt-2 w-full rounded-lg border border-blue-200 bg-white p-2 text-blue-800">
                            {facebookPages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
                          </select>
                        </label>
                      )}
                      {renderCaptionOverride('FACEBOOK', 'Facebook')}
                    </div>
                  )}
                  {platforms.includes('TELEGRAM') && (
                    <div className="space-y-3">
                      {!hasSharedVideoField && videoFile && !telegramMediaFile && (
                        <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                          {language === 'km' ? 'Telegram នឹងប្រើវីដេអូរួម៖ ' : 'Telegram will use the shared video: '}{videoFile.name}
                        </p>
                      )}
                      {hasSharedVideoField && !showTelegramFileInput ? (
                        <button
                          type="button"
                          onClick={() => setShowTelegramFileInput(true)}
                          className="text-xs font-bold text-sky-600 hover:underline dark:text-sky-400"
                        >
                          + Use a different file for Telegram (reuses the video above by default)
                        </button>
                      ) : (
                        <div>
                          <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">
                            Telegram image or video{hasSharedVideoField ? ' (optional -- reuses the video above if left blank)' : ''}
                          </label>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
                            onChange={(e) => {
                              const nextFile = e.target.files?.[0] || null;
                              if (nextFile?.type.startsWith('video/') && !videoFile) setVideoFile(nextFile);
                              if (!nextFile && telegramMediaFile === videoFile) setVideoFile(null);
                              setTelegramMediaFile(nextFile);
                            }}
                            className="w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:font-bold file:text-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                          />
                          {telegramMediaFile && (
                            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                              Selected: {telegramMediaFile.name} ({formatFileSize(telegramMediaFile.size)})
                            </p>
                          )}
                        </div>
                      )}
                      <div className="p-3 bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800/60 rounded-xl flex items-start gap-2 text-sky-600 dark:text-sky-300 text-xs">
                        <Upload size={14} className="mt-0.5 shrink-0" />
                        <p>Telegram can post text, image, or video. If you add media, the text will be used as the caption.</p>
                      </div>
                      {renderCaptionOverride('TELEGRAM', 'Telegram')}
                    </div>
                  )}
                </div>

                <div className="flex gap-4 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isSubmitting}
                    className="flex-1 py-4 bg-brand-50 text-brand-700 border border-brand-100 font-bold rounded-2xl hover:bg-brand-100 transition-all disabled:opacity-50 dark:bg-slate-800 dark:border-slate-700 dark:text-brand-400 dark:hover:bg-slate-700"
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
