import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Bot, Zap, Plus, Sparkles, Clock, X, Send, Share2, Loader2, AlertCircle, Upload, Youtube, Facebook, RefreshCw } from 'lucide-react';
import { formatImageKitUploadError } from '../../shared/imageKitError.js';
import AITrainer from './AITrainer';
import Suggestions from './Suggestions';
import Scheduler from './Scheduler';
import ActivityPulse from './ActivityPulse';
import { db } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useLanguage } from '../contexts/LanguageContext';
import { saveLocalMedia } from '../lib/localMediaStore';
import { withUploadTimeout } from '../lib/withUploadTimeout';
import { requireTikTokAutomationConnection, requireYouTubeAutomationConnection } from '../lib/tiktokConnection';

import { useAuth } from '../contexts/AuthContext';
import { ScheduleHandoffRequest } from '../types';
import { recordAuditEvent } from '../lib/auditClient';

type Platform = 'TIKTOK' | 'YOUTUBE' | 'INSTAGRAM' | 'TWITTER' | 'TELEGRAM' | 'FACEBOOK';
type TikTokCreator = {
  creator_nickname?: string;
  creator_username?: string;
  privacy_level_options: string[];
  max_video_post_duration_sec?: number;
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
};

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
  const [submissionStage, setSubmissionStage] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const pendingGroupIdRef = React.useRef<string | null>(null);
  const submittingRef = React.useRef(false);
  const handledHandoffRef = React.useRef<string | null>(null);
  const videoFileInputRef = React.useRef<HTMLInputElement>(null);
  const telegramFileInputRef = React.useRef<HTMLInputElement>(null);

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
  // Smart Schedule always uses Direct Post. Inbox drafts require the owner
  // to finish publishing inside TikTok.
  const [tiktokCreator, setTikTokCreator] = useState<TikTokCreator | null>(null);
  const [tiktokCreatorLoading, setTikTokCreatorLoading] = useState(false);
  const [tiktokCreatorRefresh, setTikTokCreatorRefresh] = useState(0);
  const [tiktokCreatorError, setTikTokCreatorError] = useState('');
  const [tiktokPrivacy, setTikTokPrivacy] = useState('');
  const [tiktokConsent, setTikTokConsent] = useState(false);
  const [tiktokAllowComment, setTikTokAllowComment] = useState(false);
  const [tiktokAllowDuet, setTikTokAllowDuet] = useState(false);
  const [tiktokAllowStitch, setTikTokAllowStitch] = useState(false);
  const [tiktokCommercial, setTikTokCommercial] = useState(false);
  const [tiktokOwnBrand, setTikTokOwnBrand] = useState(false);
  const [tiktokBrandedContent, setTikTokBrandedContent] = useState(false);
  const [tiktokAiGenerated, setTikTokAiGenerated] = useState(true);
  const [tiktokVideoSeconds, setTikTokVideoSeconds] = useState<number | null>(null);
  const [tiktokPreviewUrl, setTikTokPreviewUrl] = useState('');
  const [tiktokJustConnected, setTiktokJustConnected] = useState(false);
  const togglePlatform = (id: Platform) => {
    if (isSubmitting || completedPlatforms.includes(id)) return;
    setFormError(null);
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
  const [hostedVideo, setHostedVideo] = useState<{ url: string; name: string } | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const sharedVideoName = videoFile?.name || hostedVideo?.name || null;
  const sharedMediaName = imageFile?.name || sharedVideoName || null;
  useEffect(() => {
    setTikTokVideoSeconds(null);
    setTikTokConsent(false);
    if (!isModalOpen) {
      setTikTokPreviewUrl('');
      return;
    }
    if (!videoFile) {
      setTikTokPreviewUrl(hostedVideo?.url || '');
      return;
    }
    const url = URL.createObjectURL(videoFile);
    setTikTokPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile, hostedVideo, isModalOpen]);

  useEffect(() => {
    setTikTokCreator(null);
    setTikTokCreatorError('');
    setTikTokPrivacy('');
    setTikTokConsent(false);
    if (!isModalOpen || !platforms.includes('TIKTOK') || !user || isDemoMode) return;
    let active = true;
    setTikTokCreatorLoading(true);
    void (async () => {
      try {
        const idToken = await user.getIdToken();
        const response = await fetch('/api/tiktok/publish?action=creatorInfo', {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.creator) {
          throw new Error(result.error?.code === 'scope_not_authorized'
            ? 'TikTok has not granted Direct Post (video.publish). Enable it in TikTok Developer Portal, then reconnect TikTok.'
            : result.error?.message || 'Could not load TikTok posting settings.');
        }
        if (active) setTikTokCreator(result.creator);
      } catch (error) {
        if (active) setTikTokCreatorError(error instanceof Error ? error.message : 'Could not load TikTok posting settings.');
      } finally {
        if (active) setTikTokCreatorLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isModalOpen, platforms.includes('TIKTOK'), user?.uid, isDemoMode, tiktokJustConnected, tiktokCreatorRefresh]);
  const [telegramMediaFile, setTelegramMediaFile] = useState<File | null>(null);
  const [showTelegramFileInput, setShowTelegramFileInput] = useState(false);
  // Every platform whose auto-post reuses the one shared "video above" field
  // (Telegram also reuses it, but through its own optional field below).
  const hasSharedVideoField = platforms.includes('TIKTOK') || platforms.includes('YOUTUBE') || platforms.includes('FACEBOOK') || Boolean(imageFile);
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
  const [isConnectingTikTok, setIsConnectingTikTok] = useState(false);
  const [isConnectingFacebook, setIsConnectingFacebook] = useState(false);
  const [facebookPages, setFacebookPages] = useState<{ id: string; name: string }[]>([]);
  const [facebookPageId, setFacebookPageId] = useState('');
  const [facebookConnected, setFacebookConnected] = useState(false);
  const [facebookSetupReady, setFacebookSetupReady] = useState<boolean | null>(null);
  const [facebookConnectionLoading, setFacebookConnectionLoading] = useState(false);
  const [facebookConnectionError, setFacebookConnectionError] = useState('');

  const loadFacebookPages = async () => {
    if (!user) return;
    setFacebookConnectionLoading(true);
    setFacebookConnectionError('');
    try {
      const response = await fetch('/api/tiktok/me?action=facebookAutomation', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not check Facebook Pages.');
      const pages = Array.isArray(data.pages) ? data.pages : [];
      setFacebookPages(pages);
      setFacebookPageId(data.selectedPageId || pages[0]?.id || '');
      setFacebookConnected(data.connected === true && pages.length > 0);
      setFacebookSetupReady(data.setupReady !== false);
      return { ...data, pages, selectedPageId: data.selectedPageId || pages[0]?.id || '' };
    } catch (error) {
      setFacebookPages([]);
      setFacebookPageId('');
      setFacebookConnected(false);
      setFacebookConnectionError(error instanceof Error ? error.message : 'Could not check Facebook Pages.');
      throw error;
    } finally {
      setFacebookConnectionLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !isModalOpen || !platforms.includes('FACEBOOK')) return;
    let active = true;
    loadFacebookPages().catch(error => {
      if (active) setFacebookConnectionError(error.message);
    });
    return () => { active = false; };
  }, [user?.uid, isModalOpen, platforms.includes('FACEBOOK')]);

  // The OAuth callback posts this message back before closing its popup.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'YOUTUBE_AUTH_SUCCESS') setYoutubeJustConnected(true);
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') setTiktokJustConnected(true);
      if (event.data?.type === 'FACEBOOK_AUTH_SUCCESS') loadFacebookPages().catch(error => setFacebookConnectionError(error.message));
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
  // create-post form with generated media and opens the modal. The generated
  // video is shared by all destinations selected in the form.
  React.useEffect(() => {
    if (!handoffRequest || handledHandoffRef.current === handoffRequest.id) return;
    handledHandoffRef.current = handoffRequest.id;
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
    setFormError(null);
    setVideoFile(null);
    setHostedVideo(null);
    setImageFile(null);
    setTelegramMediaFile(null);
    setShowTelegramFileInput(false);
    const requestId = handoffRequest.id;

    // Generated videos are already hosted in app storage. Keep that URL as
    // the shared media for every selected destination; downloading it through
    // a serverless response just to manufacture a File can fail for larger
    // videos and incorrectly leave the form showing "No file chosen".
    if (handoffRequest.kind === 'video' && /^https:\/\//i.test(handoffRequest.mediaDataUrl) && !isDemoMode) {
      setHostedVideo({ url: handoffRequest.mediaDataUrl, name: handoffRequest.mediaName });
      setIsAttachingHandoffMedia(false);
    } else {
      setIsAttachingHandoffMedia(true);
      (async () => {
      try {
        // Images and inline media still need File objects. ImageKit delivery
        // is cross-origin, so route those remote downloads through our proxy.
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
          // Inline videos need one shared File for every selected destination.
          setVideoFile(file);
          setTelegramMediaFile(file);
        } else {
          setImageFile(file);
          setTelegramMediaFile(null);
          setVideoFile(null);
        }
      } catch (error) {
        // Keep a clear manual recovery path for inline media or images that
        // could not be converted to a File.
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
    }

    setContent(handoffRequest.caption);
    // A generated video is one campaign asset. Preselect every supported
    // video destination so the handoff does not silently schedule Telegram
    // alone; the creator can still remove destinations before submitting.
    setPlatforms(handoffRequest.kind === 'video'
      ? ['TIKTOK', 'FACEBOOK', 'YOUTUBE', 'TELEGRAM']
      : ['FACEBOOK', 'TELEGRAM']);
    setIsModalOpen(true);
    onHandoffConsumed?.(handoffRequest.id);
  }, [handoffRequest?.id]);

  const handleTrainingComplete = () => {
    setActivityVersion(v => v + 1);
  };

  const openSuggestedTikTokSchedule = (file: File, caption: string, date: Date) => {
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
    setFormError(null);
    setContent(caption);
    setPlatformCaptions({});
    setVideoFile(file);
    setHostedVideo(null);
    setImageFile(null);
    setTelegramMediaFile(null);
    setPlatforms(['TIKTOK']);
    setScheduledTime(getLocalISOString(date));
    setIsModalOpen(true);
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

  const resetFormAfterSchedule = () => {
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
    setIsModalOpen(false);
    setContent(DEFAULT_HASHTAGS);
    setPlatformCaptions({});
    setCustomizingCaptionFor({});
    setVideoFile(null);
    setHostedVideo(null);
    setImageFile(null);
    setTelegramMediaFile(null);
    setShowTelegramFileInput(false);
    setTikTokPrivacy('');
    setTikTokConsent(false);
    setTikTokCommercial(false);
    setTikTokOwnBrand(false);
    setTikTokBrandedContent(false);

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
      ? (telegramMediaFile || videoFile || imageFile)
      : platform === 'TIKTOK' || platform === 'YOUTUBE' || platform === 'FACEBOOK'
        ? (platform === 'FACEBOOK' && imageFile ? imageFile : videoFile)
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
      : platform === 'FACEBOOK'
      ? (imageFile ? 'FACEBOOK_PHOTO_PREVIEW_LOCAL' : 'FACEBOOK_REEL_PREVIEW_LOCAL')
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

    if (isAttachingHandoffMedia) {
      setFormError('Still attaching the generated media — please wait a moment and try again.');
      return;
    }

    const userToUse = user || (isDemoMode ? { uid: 'demo-user' } : null);

    const requiresVideo = platforms.includes('TIKTOK') || platforms.includes('YOUTUBE') || (platforms.includes('FACEBOOK') && !imageFile);
    if (imageFile && (platforms.includes('TIKTOK') || platforms.includes('YOUTUBE'))) {
      setFormError(language === 'km'
        ? 'រូបភាពរក្សាជារូបភាព។ សូមដក TikTok និង YouTube ចេញពីជម្រើសនេះ ឬជ្រើសវីដេអូសម្រាប់បណ្តាញទាំងបួន។'
        : 'This image stays an image. Remove TikTok and YouTube from this schedule, or choose a video for all four destinations.');
      return;
    }
    // Telegram can post text-only or media-only, so it's the one case where a
    // blank caption is fine -- but only when it's the *sole* destination and
    // has its own media, since a combined post still needs a caption/title
    // for the other platform(s) it's also going to.
    const telegramOnlyWithMedia = platforms.length === 1 && platforms[0] === 'TELEGRAM' && !!(telegramMediaFile || videoFile || hostedVideo || imageFile);
    // A platform is fine with no caption only in the telegramOnlyWithMedia
    // case above -- every other selected platform needs *some* resolved
    // caption, whether that's its own override or the shared draft.
    const missingCaption = platforms.some((p) => !captionFor(p) && !(p === 'TELEGRAM' && telegramOnlyWithMedia));
    if (missingCaption || !scheduledTime || !userToUse || (requiresVideo && !videoFile && !hostedVideo)) {
      setFormError(t('fillAllFieldsErr'));
      return;
    }

    if (platforms.includes('TIKTOK') && !isDemoMode) {
      const validPrivacy = tiktokCreator?.privacy_level_options?.includes(tiktokPrivacy);
      const maxDuration = Number(tiktokCreator?.max_video_post_duration_sec);
      if (!validPrivacy || !Number.isFinite(tiktokVideoSeconds) || !tiktokVideoSeconds || tiktokVideoSeconds <= 0 ||
          (maxDuration > 0 && tiktokVideoSeconds > maxDuration) ||
          (tiktokCommercial && !tiktokOwnBrand && !tiktokBrandedContent) ||
          (tiktokBrandedContent && tiktokPrivacy === 'SELF_ONLY') || !tiktokConsent) {
        setFormError('Choose TikTok visibility, review the video and posting options, then agree to Direct Post before scheduling.');
        return;
      }
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
    const effectiveTelegramMedia = telegramMediaFile || (platforms.includes('TELEGRAM') ? (videoFile || imageFile) : null);
    const mediaError = platforms.includes('TELEGRAM') ? validateTelegramMedia(effectiveTelegramMedia, isDemoMode) : null;
    if (mediaError) {
      setFormError(mediaError);
      return;
    }
    if (platforms.includes('FACEBOOK') && imageFile && imageFile.size > 10 * MB) {
      setFormError('Facebook Page photos must be under 10 MB. Choose a smaller image.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmissionStage('Checking connected accounts…');
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
          if (!data?.connected || !data.selectedPageId) throw new Error(data?.setupReady === false
            ? 'Facebook scheduling needs the Meta app credentials configured on the server.'
            : 'Connect a Facebook Page, then choose it before scheduling.');
          selectedFacebookPageId = data.pages.some((page: { id: string }) => page.id === facebookPageId) ? facebookPageId : data.selectedPageId;
        })] : []),
      ]);

      // Uploaded Files use one video upload. Generated hosted videos already
      // have one URL that can be reused for every selected destination.
      if (requiresVideo || effectiveTelegramMedia || hostedVideo) setSubmissionStage('Preparing media…');
      let videoUrl = hostedVideo?.url || '';
      let videoImageKitUrl = '';
      let imageUrl = '';
      if (requiresVideo && videoFile) {
        // Facebook fetches the source URL itself, while YouTube and TikTok
        // download it from our server. A single public ImageKit URL works for
        // all four destinations and prevents a second Telegram upload.
        const uploaded = await uploadMediaViaImageKit(videoFile, idToken);
        videoUrl = uploaded.mediaUrl;
        videoImageKitUrl = uploaded.mediaUrl;
      }
      if (platforms.includes('FACEBOOK') && imageFile) {
        const uploaded = await uploadMediaViaImageKit(imageFile, idToken);
        imageUrl = uploaded.mediaUrl;
      }

      let telegramMediaUrl = '';
      let telegramMediaType: 'photo' | 'video' | null = null;
      if (platforms.includes('TELEGRAM') && !effectiveTelegramMedia && hostedVideo) {
        telegramMediaUrl = hostedVideo.url;
        telegramMediaType = 'video';
      } else if (platforms.includes('TELEGRAM') && effectiveTelegramMedia) {
        // Reuse the same upload whenever Telegram uses the shared video.
        if (effectiveTelegramMedia === videoFile && videoImageKitUrl) {
          telegramMediaUrl = videoImageKitUrl;
          telegramMediaType = 'video';
        } else if (effectiveTelegramMedia === imageFile && imageUrl) {
          telegramMediaUrl = imageUrl;
          telegramMediaType = 'photo';
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
          setSubmissionStage(`Saving ${platform.toLowerCase()} schedule…`);
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
            if (data.preciseDeliveryQueued !== true) {
              deliveryWarnings.push('TELEGRAM was saved, but exact-time delivery could not be queued. The backup scheduler will retry it and may run late.');
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
            videoUrl: ['TIKTOK', 'YOUTUBE', 'FACEBOOK'].includes(platform) && !imageFile ? videoUrl : '',
            videoName: imageFile ? null : sharedVideoName,
            ...(platform === 'FACEBOOK' ? { facebookPageId: selectedFacebookPageId } : {}),
            mediaUrl: platform === 'FACEBOOK' && imageFile ? imageUrl : '',
            mediaName: platform === 'FACEBOOK' && imageFile ? imageFile.name : null,
            mediaType: platform === 'FACEBOOK' && imageFile ? 'photo' : null,
            publishMode: platform === 'TIKTOK'
              ? 'TIKTOK_DIRECT_POST'
              : platform === 'YOUTUBE'
                ? 'YOUTUBE_AUTO_POST'
                : platform === 'FACEBOOK' ? (imageFile ? 'FACEBOOK_PHOTO_AUTO_POST' : 'FACEBOOK_REEL_AUTO_POST') : 'PLANNED_ONLY',
            ...(platform === 'TIKTOK' ? { directPostOptions: {
              privacyLevel: tiktokPrivacy,
              durationSeconds: tiktokVideoSeconds,
              allowComment: tiktokAllowComment,
              allowDuet: tiktokAllowDuet,
              allowStitch: tiktokAllowStitch,
              commercialDisclosure: tiktokCommercial,
              ownBrand: tiktokOwnBrand,
              brandedContent: tiktokBrandedContent,
              aiGenerated: tiktokAiGenerated,
              consent: tiktokConsent,
            } } : {}),
            createdAt: serverTimestamp()
          });
          void recordAuditEvent('scheduled_post_created', {
            platform,
            scheduledTime: scheduledDate.toISOString(),
            hasMedia: Boolean(videoUrl || imageUrl),
          });
          if (platform === 'TIKTOK' || platform === 'YOUTUBE' || platform === 'FACEBOOK') {
            // Await the precise callback before reporting success. A serverless
            // response can stop an unawaited fetch, leaving only the slower
            // periodic poller. The Firestore post remains scheduled if QStash
            // fails, so show a delivery warning instead of failing the post.
            try {
              setSubmissionStage(`Queueing ${platform.toLowerCase()} delivery…`);
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
      setScheduleNotice(deliveryWarnings.length
        ? deliveryWarnings.join(' ')
        : `Saved ${platforms.join(', ')} for ${scheduledDate.toLocaleString()}. Track each destination in Content Timeline.`);
    } catch (err) {
      console.error('Error creating post:', err);
      const message = err instanceof Error ? err.message : t('failedSavePostErr');
      setFormError(`Failed to save post: ${message}`);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
      setSubmissionStage('');
    }
  };

  const closeModal = () => {
    if (submittingRef.current) return;
    setIsModalOpen(false);
    setFormError(null);
    pendingGroupIdRef.current = null;
    setCompletedPlatforms([]);
    setIsSubmitting(false);
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
           <Suggestions activityVersion={activityVersion} onScheduleSuggestion={openSuggestedTikTokSchedule} />
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

              <form onSubmit={handleCreatePost} className="space-y-5 p-5 sm:p-8">
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

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-brand-700 dark:text-brand-300 mb-2">1. {t('platform')} · {language === 'km' ? 'ជ្រើសរើសកន្លែងផ្សាយ' : 'Choose destinations'}</label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'TIKTOK', icon: Share2 },
                          { id: 'YOUTUBE', icon: Youtube },
                          { id: 'TELEGRAM', icon: Send },
                          { id: 'FACEBOOK', icon: Facebook }
                        ].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            disabled={isSubmitting || completedPlatforms.includes(p.id as Platform)}
                            onClick={() => togglePlatform(p.id as Platform)}
                            aria-pressed={platforms.includes(p.id as Platform)}
                            className={`p-3 rounded-xl border flex items-center justify-center gap-2 transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                              platforms.includes(p.id as Platform)
                                ? 'bg-brand-50 border-brand-500 text-brand-600 dark:bg-slate-800'
                                : 'bg-white border-brand-100 text-slate-400 hover:border-brand-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            <p.icon size={16} />
                            <span className="text-xs font-bold">{p.id.charAt(0) + p.id.slice(1).toLowerCase()}</span>
                            {completedPlatforms.includes(p.id as Platform) && <span className="text-[10px]">{language === 'km' ? 'បានកំណត់' : 'Saved'}</span>}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-brand-700 dark:text-brand-300 mb-2">2. {t('publishTime')}</label>
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
                    <div className="space-y-3 rounded-2xl border border-brand-100 p-4 dark:border-slate-700">
                      <div>
                        <h4 className="text-sm font-bold text-brand-700 dark:text-brand-300">
                          {language === 'km' ? '3. រូបភាព ឬវីដេអូ' : '3. Media'}
                        </h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {language === 'km' ? 'ជ្រើសឯកសារម្តង សម្រាប់កន្លែងផ្សាយដែលបានជ្រើស។' : 'Choose one file for your selected destinations.'}
                        </p>
                      </div>
                      {isAttachingHandoffMedia && <p role="status" className="text-xs text-brand-700">Attaching your generated video…</p>}
                      <input
                        ref={videoFileInputRef}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
                        aria-label={language === 'km' ? 'ជ្រើសរូបភាព ឬវីដេអូ' : 'Choose an image or video'}
                        onChange={(e) => {
                          const nextFile = e.target.files?.[0] || null;
                          if (!nextFile) return;
                          // A generated handoff initially fills both slots with
                          // the same File. Replacing it must update Telegram too;
                          // an explicitly different Telegram file stays intact.
                          setTelegramMediaFile((current) => current === videoFile ? null : current);
                          setHostedVideo(null);
                          if (nextFile.type.startsWith('image/')) {
                            setImageFile(nextFile);
                            setVideoFile(null);
                            setPlatforms(['FACEBOOK', 'TELEGRAM']);
                          } else {
                            setVideoFile(nextFile);
                            setImageFile(null);
                          }
                          setFormError(null);
                          // Allow selecting the same file again after a replacement.
                          e.target.value = '';
                        }}
                        className="sr-only"
                      />
                      <div className="flex min-w-0 items-center gap-3 rounded-xl bg-brand-50 p-3 dark:bg-slate-700">
                        <button
                          type="button"
                          onClick={() => videoFileInputRef.current?.click()}
                          disabled={isAttachingHandoffMedia || isSubmitting}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          <Upload size={14} />
                          {sharedMediaName ? (language === 'km' ? 'ប្តូរ' : 'Replace') : (language === 'km' ? 'ជ្រើសឯកសារ' : 'Choose file')}
                        </button>
                        <p className="min-w-0 truncate text-xs font-medium text-slate-600 dark:text-slate-200" title={sharedMediaName || undefined}>
                          {sharedMediaName || (language === 'km' ? 'មិនទាន់មានឯកសារ' : 'No file selected')}
                          {(videoFile || imageFile) && ` · ${formatFileSize((videoFile || imageFile).size)}`}
                        </p>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {imageFile
                          ? (language === 'km' ? 'រូបភាពនេះនឹងផុសទៅ Facebook និង Telegram ដោយស្វ័យប្រវត្តិ។ TikTok និង YouTube ត្រូវការវីដេអូក្នុង Smart Schedule នេះ។' : 'This image automatically posts to Facebook and Telegram. TikTok and YouTube require a video in this scheduler.')
                          : (language === 'km' ? 'វីដេអូនេះប្រើរួមគ្នាសម្រាប់កន្លែងដែលបានជ្រើស។ ' : 'The selected destinations share this video. ')}
                        {!imageFile && <>
                        {platforms.includes('YOUTUBE') && !platforms.includes('TIKTOK') && !platforms.includes('FACEBOOK')
                          ? 'Horizontal 16:9 MP4, MOV, or WebM. Uploads automatically to your connected YouTube channel at the scheduled time.'
                          : platforms.includes('TIKTOK') || platforms.includes('FACEBOOK')
                            ? 'Use one portrait 9:16 video for all selected platforms. MP4, MOV, or WebM.'
                          : 'MP4, MOV, or WebM.'}
                        {platforms.includes('TELEGRAM') && !telegramMediaFile && ' Telegram also reuses this video unless you attach a different file below.'}
                        </>}
                      </p>
                    </div>
                  )}
                  {platforms.includes('TIKTOK') && (
                    <div className="rounded-2xl border border-brand-100 p-4 dark:border-slate-700">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-bold text-brand-700 dark:text-brand-300">TikTok</h4>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          {language === 'km' ? 'ផុសស្វ័យប្រវត្តិតាមម៉ោង' : 'Posts at scheduled time'}
                        </span>
                      </div>
                      {!isDemoMode && (
                        <div className="mt-4 space-y-4 text-xs text-slate-700 dark:text-slate-200">
                          {tiktokCreatorLoading && <p role="status">Loading TikTok creator settings…</p>}
                          {tiktokCreatorError && <p role="alert" className="text-red-700 dark:text-red-300">{tiktokCreatorError}</p>}
                          {!tiktokCreator && !tiktokCreatorLoading && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 p-3 dark:bg-slate-700">
                              <p>{language === 'km' ? 'ភ្ជាប់គណនី TikTok ដើម្បីកំណត់ការផ្សាយ។' : 'Connect TikTok to schedule this post.'}</p>
                              <button type="button" onClick={connectTikTok} disabled={isConnectingTikTok} className="rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white disabled:opacity-50">
                                {isConnectingTikTok ? 'Connecting…' : (language === 'km' ? 'ភ្ជាប់ TikTok' : 'Connect TikTok')}
                              </button>
                            </div>
                          )}
                          {tiktokCreator && (
                            <>
                              <p className="font-semibold text-slate-800 dark:text-slate-100">{language === 'km' ? 'គណនី៖ ' : 'Posting to '}{tiktokCreator.creator_nickname || tiktokCreator.creator_username || 'your TikTok account'}</p>
                              {tiktokPreviewUrl && (
                                <video
                                  key={tiktokPreviewUrl}
                                  src={tiktokPreviewUrl}
                                  controls
                                  playsInline
                                  className="max-h-52 w-full rounded-xl bg-black"
                                  onLoadedMetadata={(event) => setTikTokVideoSeconds(event.currentTarget.duration)}
                                  aria-label="Preview the video to be posted to TikTok"
                                />
                              )}
                              <p className="text-slate-500 dark:text-slate-400">Video: {Number.isFinite(tiktokVideoSeconds) && tiktokVideoSeconds ? `${tiktokVideoSeconds.toFixed(1)}s` : 'loading'} · Limit: {tiktokCreator.max_video_post_duration_sec || 'unknown'}s</p>
                              <label htmlFor="scheduled-tiktok-privacy" className="block font-semibold">{language === 'km' ? 'អ្នកណាអាចមើលវីដេអូនេះ?' : 'Who can view this video?'}</label>
                              <select id="scheduled-tiktok-privacy" value={tiktokPrivacy} onChange={(event) => setTikTokPrivacy(event.target.value)} className="w-full rounded-xl border border-brand-200 bg-white p-3 text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                                <option value="">Select visibility</option>
                                {(tiktokCreator.privacy_level_options || []).map((option) => (
                                  <option key={option} value={option} disabled={option === 'SELF_ONLY' && tiktokBrandedContent}>
                                    {option === 'PUBLIC_TO_EVERYONE' ? 'Everyone' : option === 'MUTUAL_FOLLOW_FRIENDS' ? 'Friends' : option === 'FOLLOWER_OF_CREATOR' ? 'Followers' : 'Only me'}
                                  </option>
                                ))}
                              </select>
                              {!tiktokCreator.privacy_level_options.includes('PUBLIC_TO_EVERYONE') && (
                                <div className="space-y-2 rounded-xl bg-brand-50 p-3 text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                                  <p>{tiktokCreator.privacy_level_options.includes('FOLLOWER_OF_CREATOR')
                                    ? (language === 'km'
                                      ? 'គណនី TikTok នេះជា Private។ ដើម្បីឱ្យ Public បង្ហាញ សូមបិទ Private account ក្នុង TikTok: Profile → Menu → Settings and privacy → Privacy។'
                                      : 'This TikTok account is private. To make Public available, turn off Private account in TikTok: Profile → Menu → Settings and privacy → Privacy.')
                                    : (language === 'km' ? 'TikTok មិនបានផ្តល់ជម្រើស Public សម្រាប់គណនីនេះទេ។' : 'TikTok has not offered Public for this account.')}</p>
                                  <p>{language === 'km' ? 'ការផុសជា Public ត្រូវការឱ្យ TikTok អនុម័ត app នេះសម្រាប់ការផ្សាយសាធារណៈផងដែរ។' : 'Public posting also requires TikTok approval of this app.'}</p>
                                  <button type="button" onClick={() => setTikTokCreatorRefresh((value) => value + 1)} className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline dark:text-brand-300">
                                    <RefreshCw size={13} />{language === 'km' ? 'ពិនិត្យជម្រើសម្ដងទៀត' : 'Refresh options'}
                                  </button>
                                </div>
                              )}
                              <div className="space-y-3 border-t border-brand-100 pt-4 dark:border-slate-700">
                                <label className="flex items-start gap-3"><input className="mt-0.5" type="checkbox" checked={tiktokAiGenerated} onChange={(event) => setTikTokAiGenerated(event.target.checked)} />This video contains AI-generated content</label>
                                <label className="flex items-start gap-3"><input className="mt-0.5" type="checkbox" checked={tiktokCommercial} onChange={(event) => { setTikTokCommercial(event.target.checked); setTikTokOwnBrand(false); setTikTokBrandedContent(false); }} />This video promotes a brand, product or service</label>
                              </div>
                              {tiktokCommercial && (
                                <div className="space-y-3 rounded-xl bg-brand-50 p-3 dark:bg-slate-700">
                                  <label className="flex items-center gap-2"><input type="checkbox" checked={tiktokOwnBrand} onChange={(event) => setTikTokOwnBrand(event.target.checked)} />Your brand (Promotional content)</label>
                                  <label className="flex items-center gap-2"><input type="checkbox" checked={tiktokBrandedContent} disabled={tiktokPrivacy === 'SELF_ONLY'} onChange={(event) => setTikTokBrandedContent(event.target.checked)} />Branded content (Paid partnership)</label>
                                  {tiktokPrivacy === 'SELF_ONLY' && <p>Branded content cannot use “Only me” visibility.</p>}
                                </div>
                              )}
                              {(!tiktokCreator.comment_disabled || !tiktokCreator.duet_disabled || !tiktokCreator.stitch_disabled) && (
                                <details className="rounded-xl border border-brand-100 px-3 py-2 dark:border-slate-700">
                                  <summary className="cursor-pointer font-semibold text-brand-700 dark:text-brand-300">{language === 'km' ? 'ជម្រើសបន្ថែម' : 'More options'}</summary>
                                  <div className="space-y-3 pb-1 pt-3">
                                    {([
                                      ['Allow comments', tiktokAllowComment, setTikTokAllowComment, tiktokCreator.comment_disabled],
                                      ['Allow Duet', tiktokAllowDuet, setTikTokAllowDuet, tiktokCreator.duet_disabled],
                                      ['Allow Stitch', tiktokAllowStitch, setTikTokAllowStitch, tiktokCreator.stitch_disabled],
                                    ] as const).filter(([, , , disabled]) => !disabled).map(([label, checked, setter]) => (
                                      <label key={label} className="flex items-center gap-3"><input type="checkbox" checked={checked} onChange={(event) => setter(event.target.checked)} />{label}</label>
                                    ))}
                                  </div>
                                </details>
                              )}
                              <label className="flex items-start gap-3 border-t border-brand-100 pt-4 leading-relaxed dark:border-slate-700"><input className="mt-0.5" type="checkbox" checked={tiktokConsent} onChange={(event) => setTikTokConsent(event.target.checked)} />By scheduling this Direct Post, you agree to TikTok&apos;s {tiktokBrandedContent ? 'Branded Content Policy and ' : ''}Music Usage Confirmation and consent to the video being sent at the scheduled time.</label>
                            </>
                          )}
                        </div>
                      )}
                      {renderCaptionOverride('TIKTOK', 'TikTok')}
                    </div>
                  )}
                  {platforms.includes('YOUTUBE') && (
                    <div>
                      <div className="p-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/60 rounded-xl flex items-start justify-between gap-2 text-sky-800 dark:text-sky-300 text-xs">
                        <div className="flex items-start gap-2">
                          <Youtube size={14} className="mt-0.5 shrink-0" />
                          <p>{youtubeJustConnected ? 'YouTube connected! ' : ''}Uploads automatically to your connected YouTube channel at the scheduled time -- no manual step needed.</p>
                        </div>
                        <button
                          type="button"
                          onClick={connectYouTube}
                          disabled={isConnectingYouTube}
                          className="shrink-0 rounded-lg bg-sky-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-sky-700"
                        >
                          {isConnectingYouTube ? 'Connecting…' : 'Connect YouTube'}
                        </button>
                      </div>
                      {renderCaptionOverride('YOUTUBE', 'YouTube')}
                    </div>
                  )}
                  {platforms.includes('FACEBOOK') && (
                    <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
                      <p>{imageFile
                        ? 'Facebook Page photo: this image publishes automatically to the selected Page.'
                        : 'Facebook Page Reel: portrait 9:16 video, 4–60 seconds. Publishes automatically to the selected Page.'}</p>
                      {facebookConnectionLoading && <p role="status">Checking Facebook Page connection…</p>}
                      {facebookConnectionError && <p role="alert" className="font-semibold text-red-700 dark:text-red-300">{facebookConnectionError}</p>}
                      {!facebookConnectionLoading && !facebookConnected && facebookSetupReady === false && (
                        <p role="alert" className="font-semibold">Facebook scheduling is not configured on this server. The site owner must set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_CONFIG_ID, and APP_URL in Vercel.</p>
                      )}
                      {!facebookConnectionLoading && !facebookConnected && facebookSetupReady !== false && (
                        <p role="status" className="font-semibold">No Facebook Page is connected to this account. Connect a Page with permission to create content before scheduling.</p>
                      )}
                      {facebookConnected && <p className="font-semibold">Connected Page: {facebookPages.find(page => page.id === facebookPageId)?.name || 'Select a Page below'}</p>}
                      <button type="button" onClick={connectFacebook} disabled={isConnectingFacebook || isDemoMode || facebookSetupReady === false} className="rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
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
                      {!hasSharedVideoField && sharedVideoName && !telegramMediaFile && (
                        <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">
                          {language === 'km' ? 'Telegram នឹងប្រើវីដេអូរួម៖ ' : 'Telegram will use the shared video: '}{sharedVideoName}
                        </p>
                      )}
                      {(hasSharedVideoField || sharedVideoName) && !showTelegramFileInput && !telegramMediaFile ? (
                        <button
                          type="button"
                          onClick={() => setShowTelegramFileInput(true)}
                          className="text-xs font-bold text-sky-600 hover:underline dark:text-sky-400"
                        >
                          + Use a different file for Telegram (reuses the shared video by default)
                        </button>
                      ) : (
                        <div>
                          <label className="block text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-2">
                            Telegram image or video{hasSharedVideoField ? ' (optional -- reuses the video above if left blank)' : ''}
                          </label>
                          <input
                            ref={telegramFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm"
                            onChange={(e) => {
                              const nextFile = e.target.files?.[0] || null;
                              if (nextFile?.type.startsWith('video/') && !videoFile && !hostedVideo) {
                                setVideoFile(nextFile);
                                setImageFile(null);
                              }
                              if (nextFile?.type.startsWith('image/') && !videoFile && !hostedVideo) setImageFile(nextFile);
                              if (!nextFile && telegramMediaFile === videoFile) setVideoFile(null);
                              setTelegramMediaFile(nextFile);
                              e.target.value = '';
                            }}
                            className={telegramMediaFile
                              ? 'hidden'
                              : 'w-full p-3 bg-brand-50 border border-brand-100 rounded-xl text-brand-700 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:font-bold file:text-white dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100'}
                          />
                          {telegramMediaFile && (
                            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-300">
                              <p className="break-all font-semibold">File attached: {telegramMediaFile.name} ({formatFileSize(telegramMediaFile.size)})</p>
                              <button type="button" onClick={() => telegramFileInputRef.current?.click()} className="mt-2 font-bold underline">Replace file</button>
                            </div>
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

                {isSubmitting && <p role="status" aria-live="polite" className="text-center text-xs font-semibold text-brand-700 dark:text-brand-300">{submissionStage}</p>}
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
