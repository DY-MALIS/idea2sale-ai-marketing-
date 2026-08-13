import React, { useRef, useState } from 'react';
import { 
  Sparkles, 
  Video as VideoIcon, 
  Mic, 
  Download,
  Loader2,
  RefreshCw,
  Volume2,
  Lock,
  Image as ImageIcon,
  Calendar
} from 'lucide-react';
import { cn } from '../lib/utils';
import { uint8ArrayToBase64 } from '../lib/base64';
import { readImagesIntoState } from '../lib/imageUpload';
import { motion, AnimatePresence } from 'motion/react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../hooks/useToast';
import { BusinessProfileData, CreativeAutomationRequest, ScheduleHandoffRequest } from '../types';

type ToolType = 'video' | 'voice';
type VoiceGender = 'Female' | 'Male';
type VoicePersona = 'sreymom' | 'piseth';

const MAX_VIDEO_IMAGES = 20;
// Google Veo 3.1 Fast (the underlying video model) only accepts these exact
// per-clip durations — anything else risks a rejected or misbehaving
// generation. Lengths beyond 8s are built by chaining multiple 8s clips
// together (see getVideoSegments) since the model has no longer single-shot option.
const VIDEO_LENGTH_OPTIONS = [4, 6, 8, 16, 24] as const;

// Splits a requested total video length into individual Veo-generation
// segments, each capped at 8s (the model's per-clip maximum): 4/6/8 stay a
// single clip, 16 -> [8, 8], 24 -> [8, 8, 8].
const getVideoSegments = (totalSeconds: number): number[] => {
  if (totalSeconds <= 8) return [totalSeconds];
  const segments: number[] = [];
  let remaining = totalSeconds;
  while (remaining > 0) {
    segments.push(Math.min(8, remaining));
    remaining -= 8;
  }
  return segments;
};

const FFMPEG_CORE_BASE_URL = 'https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm';
let ffmpegLoadPromise: Promise<any> | null = null;

const getFFmpeg = async () => {
  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const { FFmpeg } = await import('@ffmpeg/ffmpeg');
      const { toBlobURL } = await import('@ffmpeg/util');
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      return ffmpeg;
    })();
  }
  return ffmpegLoadPromise;
};

// deleteFile() (used throughout this file) only removes entries from ffmpeg.wasm's
// virtual filesystem — it does NOT shrink the underlying WASM linear memory, which
// emscripten only ever grows, never releases, for the lifetime of one loaded instance.
// Since getFFmpeg() reuses one singleton for the whole page session, memory from every
// past voice-over/logo/frame/concat operation this tab has ever done stays reserved.
// A multi-segment (16s/24s) video needs several full clips resident at once on top of
// that accumulated high-water mark, so it can fail from session bloat even though the
// same operation would succeed in a fresh tab. Terminating and letting getFFmpeg()
// re-create the instance is the only way to actually reclaim that memory.
const resetFFmpeg = async () => {
  if (!ffmpegLoadPromise) return;
  try {
    const ffmpeg = await ffmpegLoadPromise;
    ffmpeg.terminate();
  } catch {
    // ignore — instance may already be dead
  } finally {
    ffmpegLoadPromise = null;
  }
};

// ffmpeg.wasm's virtual filesystem (MEMFS) keeps every written/output file in memory
// until explicitly deleted, and getFFmpeg() reuses one singleton instance for the
// whole page session — without this, every clip/frame/audio file from every step of
// every video ever generated in the session stays resident, and a multi-segment
// (16s/24s) video adds several large files at once on top of that, easily exhausting
// the browser's WASM heap. Best-effort: a delete failing (e.g. file was never written
// on this path) must never mask the real error from the calling step.
const cleanupFfmpegFiles = async (ffmpeg: any, names: string[]) => {
  await Promise.all(names.map(async (name) => {
    try {
      await ffmpeg.deleteFile(name);
    } catch {
      // ignore — file may not exist on this path
    }
  }));
};

const applyVoiceOver = async (videoDataUrl: string, audioDataUrl: string, speed = 1): Promise<string> => {
  const audioExt = audioDataUrl.startsWith('data:audio/wav') ? 'wav' : 'mp3';
  const ffmpeg = await getFFmpeg();
  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile('vo_input.mp4', await fetchFile(videoDataUrl));
    await ffmpeg.writeFile(`vo_audio.${audioExt}`, await fetchFile(audioDataUrl));
    // The TTS model has no reliable way to actually speak faster on request, so narration
    // is generated at a natural pace and sped up here instead via ffmpeg's atempo filter —
    // a real, predictable speed change that doesn't risk mangling pronunciation the way
    // asking the model to "talk fast" did. atempo only accepts 0.5-2.0 per instance, which
    // covers every speed this app requests.
    const safeSpeed = Number.isFinite(speed) ? Math.min(2, Math.max(0.5, speed)) : 1;
    await ffmpeg.exec([
      '-i', 'vo_input.mp4',
      '-i', `vo_audio.${audioExt}`,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'copy',
      '-filter:a', `atempo=${safeSpeed}`,
      '-c:a', 'aac',
      '-shortest',
      'vo_output.mp4',
    ]);
    const data = await ffmpeg.readFile('vo_output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not finalize the voice-over video.'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Voice-over merge failed, keeping the original video audio:', error);
    return videoDataUrl;
  } finally {
    await cleanupFfmpegFiles(ffmpeg, ['vo_input.mp4', `vo_audio.${audioExt}`, 'vo_output.mp4']);
  }
};

const overlayLogoOnVideo = async (videoDataUrl: string, logoDataUrl: string): Promise<string> => {
  if (!logoDataUrl) return videoDataUrl;
  const ffmpeg = await getFFmpeg();
  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile('input.mp4', await fetchFile(videoDataUrl));
    await ffmpeg.writeFile('logo.jpg', await fetchFile(logoDataUrl));
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-i', 'logo.jpg',
      '-filter_complex', '[1:v]scale=205:-1[logo];[0:v][logo]overlay=x=main_w*0.04:y=main_h-overlay_h-main_h*0.04',
      // Overlaying forces a video re-encode (stream copy isn't possible with a filter),
      // and ffmpeg's default x264 preset is "medium" — noticeably slow in a single-threaded
      // WASM build. "ultrafast" trades some file size for a much faster encode, which matters
      // more here since this runs synchronously in the user's browser after every generation.
      '-preset', 'ultrafast',
      '-crf', '23',
      '-codec:a', 'copy',
      'output.mp4',
    ]);
    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not finalize the watermarked video.'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Logo overlay failed, using the original video:', error);
    return videoDataUrl;
  } finally {
    await cleanupFfmpegFiles(ffmpeg, ['input.mp4', 'logo.jpg', 'output.mp4']);
  }
};

// Grabs the last frame of a generated clip so it can be handed to the next
// segment's generation as a reference image, giving chained clips visual
// continuity instead of jump-cutting to an unrelated scene.
const extractLastFrame = async (videoUrl: string): Promise<{ base64: string; mimeType: string }> => {
  const ffmpeg = await getFFmpeg();
  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile('frame_source.mp4', await fetchFile(videoUrl));
    await ffmpeg.exec(['-sseof', '-1', '-i', 'frame_source.mp4', '-update', '1', '-q:v', '2', 'last_frame.jpg']);
    const data = await ffmpeg.readFile('last_frame.jpg');
    return { base64: uint8ArrayToBase64(data as Uint8Array), mimeType: 'image/jpeg' };
  } catch (error) {
    // ffmpeg.wasm can reject with a bare string or an object with no readable
    // .message (e.g. an out-of-memory abort) — normalize so the failure is
    // never silently mistaken for an OpenRouter API/credits problem upstream.
    console.error('extractLastFrame failed:', error);
    throw new Error('Could not prepare the next video segment (ran out of browser memory while chaining clips). Try a shorter total duration.');
  } finally {
    await cleanupFfmpegFiles(ffmpeg, ['frame_source.mp4', 'last_frame.jpg']);
  }
};

// Joins multiple generated clips (all the same resolution/codec, since they
// all came from the same Veo request settings) into one final video via
// ffmpeg's concat demuxer, which stream-copies instead of re-encoding.
const concatenateVideoClips = async (clipUrls: string[]): Promise<string> => {
  if (clipUrls.length <= 1) return clipUrls[0];
  const ffmpeg = await getFFmpeg();
  const fileNames = clipUrls.map((_, i) => `segment_${i}.mp4`);
  try {
    const { fetchFile } = await import('@ffmpeg/util');
    for (let i = 0; i < clipUrls.length; i += 1) {
      await ffmpeg.writeFile(fileNames[i], await fetchFile(clipUrls[i]));
    }
    await ffmpeg.writeFile('concat_list.txt', fileNames.map((name) => `file '${name}'`).join('\n'));
    await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-c', 'copy', 'concat_output.mp4']);
    const data = await ffmpeg.readFile('concat_output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Could not merge the video segments.'));
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    // Same rationale as extractLastFrame: never let a raw, message-less
    // ffmpeg.wasm failure surface as a misleading "check your API key" error.
    console.error('concatenateVideoClips failed:', error);
    throw new Error('Could not merge the video segments (ran out of browser memory while combining clips). Try a shorter total duration.');
  } finally {
    await cleanupFfmpegFiles(ffmpeg, [...fileNames, 'concat_list.txt', 'concat_output.mp4']);
  }
};

// Starts one Veo generation and polls until the clip is ready.
const attemptGenerateVideoClip = async (
  prompt: string,
  images: { base64: string; mimeType: string }[],
  duration: number,
): Promise<string> => {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'videoGenerate', prompt, images, duration }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Video generation failed.');
  const jobId = data.jobId;
  for (let attempt = 0; attempt < 48 && jobId; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusResponse = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'videoStatus', jobId }),
    });
    const statusData = await statusResponse.json();
    if (!statusResponse.ok) throw new Error(statusData.error || 'Video generation failed.');
    if (statusData.videoUrl) return statusData.videoUrl;
  }
  throw new Error('Video is still processing. Please try again shortly.');
};

// The underlying Veo model occasionally reports a job as finished but produces
// zero video output (e.g. "Video generation completed with no output") — a
// provider-side hiccup rather than a real problem with the prompt, so one
// automatic retry before surfacing an error to the user is worth the cost,
// the same resilience pattern already used for speech transcription retries.
const generateVideoClip = async (
  prompt: string,
  images: { base64: string; mimeType: string }[],
  duration: number,
): Promise<string> => {
  try {
    return await attemptGenerateVideoClip(prompt, images, duration);
  } catch (error) {
    console.error('Video segment generation failed, retrying once:', error);
    return await attemptGenerateVideoClip(prompt, images, duration);
  }
};

interface VideoVoiceProps {
  automationRequest?: CreativeAutomationRequest | null;
  onAutomationConsumed?: (requestId: string) => void;
  onScheduleHandoff?: (request: ScheduleHandoffRequest) => void;
}

const VideoVoice: React.FC<VideoVoiceProps> = ({ automationRequest, onAutomationConsumed, onScheduleHandoff }) => {
  const { t, language } = useLanguage();
  const { user, isDemoMode } = useAuth();
  const { notify, ToastHost } = useToast();
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const logoDataUrlRef = useRef('');
  const [watermarking, setWatermarking] = useState(false);
  const [voiceOverEnabled, setVoiceOverEnabled] = useState(false);
  const [voiceOverText, setVoiceOverText] = useState('');
  const [addingVoiceOver, setAddingVoiceOver] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>('video');
  const [videoPrompt, setVideoPrompt] = useState('A realistic 8-second TikTok product ad: close-up product reveal on a real table, warm natural light, slow camera push-in, hand places the product naturally, detailed texture, cinematic depth of field, clean premium brand feeling');
  const [videoLanguage, setVideoLanguage] = useState<'Khmer' | 'English'>('Khmer');
  const [voiceLanguage, setVoiceLanguage] = useState<'Khmer' | 'English'>('Khmer');
  const [voiceGender, setVoiceGender] = useState<VoiceGender>('Female');
  const [voicePersona, setVoicePersona] = useState<VoicePersona>('sreymom');
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedKhmerVoiceURI, setSelectedKhmerVoiceURI] = useState('');
  const [selectedEnglishVoiceURI, setSelectedEnglishVoiceURI] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [videoVoiceQualityNotice, setVideoVoiceQualityNotice] = useState<string | null>(null);
  const [ttsText, setTtsText] = useState('');
  const [generatedAudio, setGeneratedAudio] = useState<string | null>(null);
  const [voiceFallbackMessage, setVoiceFallbackMessage] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [videoImages, setVideoImages] = useState<{ base64: string; mimeType: string }[]>([]);
  const [videoDuration, setVideoDuration] = useState<number>(8);
  const [segmentProgress, setSegmentProgress] = useState<{ current: number; total: number } | null>(null);
  const [mergingSegments, setMergingSegments] = useState(false);
  const [automationNotice, setAutomationNotice] = useState<string | null>(null);
  const handledAutomationRef = React.useRef<string | null>(null);

  const [aiCaption, setAiCaption] = useState('');
  const [captionLanguage, setCaptionLanguage] = useState<'Khmer' | 'English'>('Khmer');
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isPostingTikTok, setIsPostingTikTok] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [tiktokUser, setTiktokUser] = useState<any>(null);

  const voicePersonas = {
    sreymom: {
      id: 'sreymom' as VoicePersona,
      gender: 'Female' as VoiceGender,
      name: 'ស្រីមុំ',
      englishName: 'Sreymom',
      description: language === 'km'
        ? 'សំឡេងស្រីកក់ក្ដៅ ស្និទ្ធស្នាល លឿនសមរម្យ សម្រាប់លក់ផលិតផល និងបកស្រាយ។'
        : 'Warm, friendly female voice with natural marketing energy.',
      openRouterVoice: 'nova',
      browserRate: 1.82,
      browserPitch: 1.08,
      style: 'Sreymom persona: real Cambodian female creator voice, warm, friendly, confident, expressive, clear Khmer pronunciation, fast natural conversational tempo, short pauses, lively intonation, like a real person talking directly to a customer.',
    },
    piseth: {
      id: 'piseth' as VoicePersona,
      gender: 'Male' as VoiceGender,
      name: 'ពិសិដ្ឋ',
      englishName: 'Piseth',
      description: language === 'km'
        ? 'សំឡេងប្រុសជឿជាក់ ស្ងប់ និងច្បាស់ សម្រាប់ពន្យល់ ឬប្រកាសមាតិកា។'
        : 'Confident, calm male voice with clear creator-style delivery.',
      openRouterVoice: 'onyx',
      browserRate: 1.78,
      browserPitch: 0.9,
      style: 'Piseth persona: real Cambodian male creator voice, confident, calm, clear, emotionally grounded, natural Khmer pronunciation, quick conversational tempo, short pauses, natural emphasis, not announcer style, like a real person presenting useful advice.',
    },
  };

  const updateLogoDataUrl = (value: string) => {
    logoDataUrlRef.current = value;
    setLogoDataUrl(value);
  };

  React.useEffect(() => {
    const loadLogo = async () => {
      try {
        if (isDemoMode || !user) {
          const saved = JSON.parse(localStorage.getItem('demo_business_profile') || 'null');
          updateLogoDataUrl(saved?.logoDataUrl || '');
          return;
        }
        const snap = await getDoc(doc(db, 'business_profiles', user.uid));
        updateLogoDataUrl((snap.data() as BusinessProfileData | undefined)?.logoDataUrl || '');
      } catch {
        updateLogoDataUrl('');
      }
    };
    void loadLogo();
  }, [user, isDemoMode]);

  React.useEffect(() => {
    if (!('speechSynthesis' in window)) return;

    const loadBrowserVoices = () => {
      setBrowserVoices(window.speechSynthesis.getVoices());
    };

    loadBrowserVoices();
    window.speechSynthesis.onvoiceschanged = loadBrowserVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'TIKTOK_AUTH_SUCCESS') {
        setIsAuthenticating(false);
        fetch('/api/tiktok/me')
          .then(res => res.json())
          .then(data => {
            if (!data.error) setTiktokUser(data);
          })
          .catch(err => console.error("Failed to fetch user after auth", err));
      }
    };
    window.addEventListener('message', handleMessage);
    
    // Initial check
    fetch('/api/tiktok/me')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setTiktokUser(data);
      })
      .catch(() => {});

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleGenerateCaption = async () => {
    if (!videoPrompt) return;
    setIsGeneratingCaption(true);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'videoCaption', prompt: videoPrompt, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to generate caption.');
      setAiCaption(data.text || '');
    } catch (error) {
      console.error("Caption error:", error);
      notify("Failed to generate caption.", 'error');
    } finally {
      setIsGeneratingCaption(false);
    }
  };

  const handleTikTokAuth = async () => {
    if (isAuthenticating) {
      setIsAuthenticating(false);
      return;
    }
    
    setIsAuthenticating(true);
    const timeout = setTimeout(() => setIsAuthenticating(false), 10000);

    try {
      const res = await fetch('/api/auth/tiktok');
      const data = await res.json();
      if (data.url) {
        const width = 600, height = 700;
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const popup = window.open(
          data.url, 
          'tiktokAuth', 
          `width=${width},height=${height},top=${top},left=${left}`
        );
        if (!popup) {
          notify(t('allowPopups'), 'error');
          clearTimeout(timeout);
          setIsAuthenticating(false);
        }
      } else {
        notify("Failed to get auth URL", 'error');
        clearTimeout(timeout);
        setIsAuthenticating(false);
      }
    } catch (err) {
      console.error("Auth error", err);
      notify(t('authError'), 'error');
      clearTimeout(timeout);
      setIsAuthenticating(false);
    }
  };

  const handlePostToTikTok = async (videoUrl: string) => {
    if (!aiCaption) {
      notify("Please generate or write a caption first.", 'error');
      return;
    }
    setIsPostingTikTok(true);
    try {
      const idToken = user ? await user.getIdToken().catch(() => null) : null;
      const res = await fetch('/api/tiktok/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ videoUrl, title: aiCaption })
      });
      const data = await res.json();
      if (res.ok) {
        notify(data.message || t('postedToTiktok'), 'success');
      } else {
        throw new Error(data.error?.message || "Publishing failed");
      }
    } catch (error: any) {
      notify(`${t('postFailed')}: ${error.message}\n\nMake sure Vercel has TIKTOK_SCOPES with video.upload/video.publish, then reconnect TikTok so the new permission is included in the access token.`, 'error');
    } finally {
      setIsPostingTikTok(false);
    }
  };

  const tiktokDisplayName = tiktokUser?.display_name || tiktokUser?.username || tiktokUser?.open_id || 'TikTok user';

  const handleOpenKeySelector = async () => {
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setNeedsApiKey(false);
    }
  };

  const handleGenerateVideo = async (
    promptOverride?: string,
    languageOverride?: 'Khmer' | 'English',
    voiceOverTextOverride?: string,
    durationOverride?: number,
  ) => {
    const promptText = typeof promptOverride === 'string' ? promptOverride.trim() : videoPrompt.trim();
    const generationLanguage = languageOverride || videoLanguage;
    const voiceOverContent = (typeof voiceOverTextOverride === 'string' ? voiceOverTextOverride : (voiceOverEnabled ? voiceOverText : '')).trim();
    if (!promptText && !videoImages.length) return;

    setLoading(true);
    setGeneratedVideo(null);
    setVideoVoiceQualityNotice(null);
    setSegmentProgress(null);
    setMergingSegments(false);
    try {
      // Start this generation with a clean ffmpeg.wasm memory slate instead of
      // whatever accumulated from earlier videos generated in this browser tab.
      await resetFFmpeg();
      const prompt = `${generationLanguage === 'Khmer' ? 'Khmer/Cambodian context. ' : ''}${promptText || 'Create a realistic short marketing video from the uploaded reference image.'}`;
      const segments = getVideoSegments(
        VIDEO_LENGTH_OPTIONS.includes(durationOverride as typeof VIDEO_LENGTH_OPTIONS[number]) ? (durationOverride as number) : videoDuration,
      );
      const clipUrls: string[] = [];
      let referenceImages = videoImages;
      for (let i = 0; i < segments.length; i += 1) {
        setSegmentProgress(segments.length > 1 ? { current: i + 1, total: segments.length } : null);
        let segmentPrompt = prompt;
        if (i > 0) {
          referenceImages = [await extractLastFrame(clipUrls[i - 1])];
          // The reference image alone is a soft style hint, not a hard start-frame
          // constraint, so spell out the continuity requirement in the prompt too —
          // otherwise chained clips can jump-cut to an unrelated scene.
          segmentPrompt = `${prompt}\n\nThis is a direct continuation of the previous shot in the same video, picking up exactly where it left off. Keep the same subject, character appearance and outfit, location, lighting, and camera style throughout — do not cut to a different scene, restart the action, or change the setting.`;
        }
        clipUrls.push(await generateVideoClip(segmentPrompt, referenceImages, segments[i]));
      }
      setSegmentProgress(null);

      let video: string;
      if (clipUrls.length > 1) {
        setMergingSegments(true);
        try {
          video = await concatenateVideoClips(clipUrls);
        } finally {
          setMergingSegments(false);
        }
        // Free the memory used to hold every raw segment + the merge output before
        // the (also memory-heavy) logo/voice-over post-processing steps run.
        await resetFFmpeg();
      } else {
        video = clipUrls[0];
      }

      if (logoDataUrlRef.current) {
        setWatermarking(true);
        try {
          video = await overlayLogoOnVideo(video, logoDataUrlRef.current);
        } finally {
          setWatermarking(false);
        }
      }

      if (voiceOverContent) {
        setAddingVoiceOver(true);
        try {
          const persona = voicePersonas[voicePersona];
          const hasKhmerText = /[ក-៿]/.test(voiceOverContent);
          const ttsResponse = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'ttsGenerate',
              input: voiceOverContent,
              voice: persona.openRouterVoice,
              languageHint: hasKhmerText ? 'Khmer' : 'English',
              performanceStyle: `${persona.style} Read the exact provided text like you are speaking in a real conversation, not reading a script. Use human emotion, natural rhythm, clear consonants, natural pacing. Avoid robotic or AI narration.`,
            }),
          });
          const ttsData = await ttsResponse.json();
          if (ttsResponse.ok && ttsData.audioUrl) {
            // No artificial speed-up: Gemini TTS (the current primary engine)
            // already speaks at a natural human pace, and any further atempo
            // stretch — even a mild one — trades naturalness for fitting more
            // words into the clip, which is the wrong trade for how this
            // narration is meant to sound. (The Google Translate fallback
            // renders at 2x speed at its own source, unrelated to this factor.)
            video = await applyVoiceOver(video, ttsData.audioUrl, 1);
            if (ttsData.fallbackReason && hasKhmerText) {
              setVideoVoiceQualityNotice(language === 'km'
                ? 'សំឡេងក្នុង video នេះបានប្រើសំឡេងបម្រុង (Google TTS) ដែលអានមិនច្បាស់ ព្រោះម៉ូដែលសំឡេងសំខាន់មិនអាចប្រើបានពេលនេះ។ សូមសាកល្បងបង្កើត video ម្តងទៀត។'
                : 'This video used a lower-quality backup voice (Google TTS) because the main voice model was unavailable. Try generating the video again for clearer narration.');
            }
          } else {
            console.error('Voice-over TTS generation failed:', ttsData.error);
          }
        } catch (voiceError) {
          console.error('Voice-over generation failed, keeping the original video audio:', voiceError);
        } finally {
          setAddingVoiceOver(false);
        }
      }

      setGeneratedVideo(video);
      return;
    } catch (error: any) {
      console.error(error);
      // ffmpeg.wasm and other browser-side steps can reject with something
      // that isn't a normal Error (a bare string, or an object with no usable
      // .message) — fall back to a neutral message instead of always blaming
      // the OpenRouter API key/credits, which is only sometimes the real cause.
      const errorMessage = typeof error?.message === 'string' && error.message.trim()
        ? error.message
        : typeof error === 'string' && error.trim()
          ? error
          : 'Video generation failed for an unknown reason. Please try again.';
      if (/OPEN_ROUTER_API_KEY|api key/i.test(errorMessage)) setNeedsApiKey(true);
      notify(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!automationRequest || automationRequest.kind !== 'video') return;
    if (handledAutomationRef.current === automationRequest.id) return;

    const generationLanguage = automationRequest.language === 'km' ? 'Khmer' : 'English';
    const requestedVoiceOver = (automationRequest.voiceOverText || '').trim();
    const requestedDuration = VIDEO_LENGTH_OPTIONS.includes(automationRequest.duration as typeof VIDEO_LENGTH_OPTIONS[number])
      ? (automationRequest.duration as number)
      : 8;
    handledAutomationRef.current = automationRequest.id;
    setActiveTool('video');
    setVideoPrompt(automationRequest.prompt);
    setVideoLanguage(generationLanguage);
    setCaptionLanguage(generationLanguage);
    setVideoDuration(requestedDuration);
    if (requestedVoiceOver) {
      setVoiceOverEnabled(true);
      setVoiceOverText(requestedVoiceOver);
    }
    setAutomationNotice(
      language === 'km'
        ? `Agent បានរៀប brief សម្រាប់ ${automationRequest.platform} ហើយកំពុងបង្កើតវីដេអូស្វ័យប្រវត្តិ${requestedVoiceOver ? ' ជាមួយសំឡេងខ្មែរ' : ''}។`
        : `The agent prepared a ${automationRequest.platform} brief and started automatic video creation${requestedVoiceOver ? ' with a Khmer voice-over' : ''}.`,
    );
    onAutomationConsumed?.(automationRequest.id);
    void handleGenerateVideo(automationRequest.prompt, generationLanguage, requestedVoiceOver, requestedDuration);
  }, [automationRequest?.id]);

  const handleGenerateAudio = async () => {
    if (!ttsText) return;

    setAudioLoading(true);
    setGeneratedAudio(null);
    setVoiceFallbackMessage(null);
    try {
      const selectedPersona = voicePersonas[voicePersona];
      const hasKhmerText = /[\u1780-\u17FF]/.test(ttsText);
      const hasEnglishText = /[A-Za-z]/.test(ttsText);
      const languageHint = hasKhmerText && hasEnglishText
        ? 'mixed Khmer and English'
        : hasKhmerText
          ? 'Khmer'
          : voiceLanguage;
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ttsGenerate',
          input: ttsText,
          voice: selectedPersona.openRouterVoice,
          languageHint,
          performanceStyle: `${selectedPersona.style} Read the exact provided text like you are speaking in a real conversation, not reading a script. Keep Khmer words Khmer and English words English. Use human emotion, natural rhythm, clear consonants, natural pacing, short pauses, and real creator-style intonation. Avoid robotic or AI narration.`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Audio generation failed.');
      setGeneratedAudio(data.audioUrl);
    } catch (error: any) {
      console.error(error);
      if (/OPEN_ROUTER_API_KEY|api key/i.test(error.message || '')) setNeedsApiKey(true);
      const rawMessage = error.message || '';
      const friendlyMessage = /model .*does not exist|no endpoints found|unsupported model/i.test(rawMessage)
        ? (language === 'km'
          ? 'ម៉ូដែលបង្កើតសំឡេងដែលបានកំណត់ក្នុង Vercel មិនត្រឹមត្រូវទេ។ សូមដាក់ OPEN_ROUTER_TTS_MODEL=openai/gpt-audio-mini ហើយ redeploy។'
          : 'The configured TTS model is not available. Set OPEN_ROUTER_TTS_MODEL=openai/gpt-audio-mini in Vercel and redeploy.')
        : rawMessage;
      if (/[\u1780-\u17FF]/.test(ttsText)) {
        setVoiceFallbackMessage(language === 'km'
          ? 'Khmer cloud TTS មិនអាចបង្កើត MP3 បាននៅពេលនេះ។ App មិនអានជាសំឡេង English fallback ទេ ដើម្បីរក្សាការអានខ្មែរ។ សូមសាកល្បងម្តងទៀត។'
          : 'Khmer cloud TTS could not create an MP3 right now. The app did not use an English browser voice fallback, so Khmer pronunciation is preserved.');
        return;
      }
      if ('speechSynthesis' in window) {
        speakWithBrowserVoice();
        setVoiceFallbackMessage(language === 'km'
          ? 'សំឡេង Browser កំពុងដំណើរការ។ OpenRouter audio provider មិនអាចបង្កើតឯកសារ MP3 បាននៅពេលនេះ។'
          : 'Browser voice is active. The OpenRouter audio provider could not create an MP3 file right now.');
      } else {
        notify(friendlyMessage || 'Error generating audio. Please check your OpenRouter API key and credits.', 'error');
      }
    } finally {
      setAudioLoading(false);
    }
  };

  const speakWithBrowserVoice = (retryCount = 0) => {
    if (!('speechSynthesis' in window) || !ttsText.trim()) return;
    window.speechSynthesis.cancel();
    const voices = browserVoices.length ? browserVoices : window.speechSynthesis.getVoices();
    if (!voices.length && retryCount < 5) {
      window.setTimeout(() => speakWithBrowserVoice(retryCount + 1), 250);
      return;
    }
    const segments = splitTextForSpeech(ttsText);
    const selectedPersona = voicePersonas[voicePersona];

    segments.forEach((segment) => {
      const utterance = new SpeechSynthesisUtterance(segment.text);
      const matchingVoice = findBrowserVoice(voices, segment.lang, selectedPersona.gender);
      utterance.lang = segment.lang;
      if (matchingVoice) utterance.voice = matchingVoice;
      utterance.rate = segment.lang === 'km-KH'
        ? Math.min(selectedPersona.browserRate + 0.08, 1.95)
        : Math.min(selectedPersona.browserRate + 0.12, 2);
      utterance.pitch = selectedPersona.browserPitch;
      window.speechSynthesis.speak(utterance);
    });
  };

  const stopBrowserVoice = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const detectSpeechLanguage = (text: string): 'km-KH' | 'en-US' => (
    /[\u1780-\u17FF]/.test(text) ? 'km-KH' : 'en-US'
  );

  const findBrowserVoice = (
    voices: SpeechSynthesisVoice[],
    lang: 'km-KH' | 'en-US',
    gender: VoiceGender,
  ) => {
    const selectedVoiceURI = lang === 'km-KH' ? selectedKhmerVoiceURI : selectedEnglishVoiceURI;
    const selectedVoice = voices.find((voice) => voice.voiceURI === selectedVoiceURI);
    if (selectedVoice) return selectedVoice;

    const languageMatches = voices.filter((voice) => {
      const voiceLang = voice.lang.toLowerCase();
      const voiceName = voice.name.toLowerCase();
      if (lang === 'km-KH') {
        return voiceLang === 'km-kh'
          || voiceLang.startsWith('km')
          || voiceName.includes('khmer')
          || voiceName.includes('cambodian');
      }
      return voiceLang === 'en-us' || voiceLang.startsWith('en');
    });

    const femaleHints = ['female', 'woman', 'zira', 'susan', 'aria', 'jenny', 'samantha', 'victoria', 'zira'];
    const maleHints = ['male', 'man', 'david', 'mark', 'guy', 'george', 'daniel', 'alex'];
    const hints = gender === 'Male' ? maleHints : femaleHints;
    const genderMatch = languageMatches.find((voice) => (
      hints.some((hint) => voice.name.toLowerCase().includes(hint))
    ));

    return genderMatch || languageMatches[0] || null;
  };

  const splitTextForSpeech = (text: string) => {
    const tokens = text.match(/[\u1780-\u17FF]+|[A-Za-z0-9][A-Za-z0-9'._-]*|\s+|[^\sA-Za-z0-9\u1780-\u17FF]+/g) || [];
    const segments: Array<{ text: string; lang: 'km-KH' | 'en-US' }> = [];

    tokens.forEach((token) => {
      const lang = detectSpeechLanguage(token);
      const previous = segments[segments.length - 1];
      if (previous && previous.lang === lang) {
        previous.text += token;
      } else if (/^\s+$/.test(token) && previous) {
        previous.text += token;
      } else {
        segments.push({ text: token, lang });
      }
    });

    return segments.filter((segment) => segment.text.trim());
  };

  const handleScheduleThisVideo = () => {
    if (!generatedVideo) return;
    // Telegram (and most platforms) reject captions over ~1024 characters, and the raw
    // generation prompt can easily run to several times that — cap the fallback so
    // scheduling never silently fails when the user hasn't written an AI caption yet.
    onScheduleHandoff?.({
      id: `${Date.now()}-video`,
      kind: 'video',
      mediaDataUrl: generatedVideo,
      mediaName: `idea2sale-video-${Date.now()}.mp4`,
      caption: aiCaption.trim() || videoPrompt.trim().slice(0, 900),
    });
  };

  const handleDownload = () => {
    if (activeTool === 'video' && generatedVideo) {
      const link = document.createElement('a');
      link.href = generatedVideo;
      link.download = `idea2sale-video-${Date.now()}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (activeTool === 'voice' && generatedAudio) {
      const audioExt = generatedAudio.startsWith('data:audio/wav') ? 'wav' : 'mp3';
      const link = document.createElement('a');
      link.href = generatedAudio;
      link.download = `idea2sale-audio-${Date.now()}.${audioExt}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (activeTool === 'voice' && voiceFallbackMessage) {
      const hasMixedLanguageText = /[\u1780-\u17FF]/.test(ttsText) && /[A-Za-z]/.test(ttsText);
      const scriptBlob = new Blob([
        `Voice language: ${hasMixedLanguageText ? 'Auto Khmer + English' : voiceLanguage}\n\n${ttsText.trim() || 'No script text was provided.'}\n`,
      ], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(scriptBlob);
      link.download = `aime-browser-voice-script-${Date.now()}.txt`;
      document.body.appendChild(link);
      link.click();
      URL.revokeObjectURL(link.href);
      document.body.removeChild(link);
    }
  };

  const hasKhmerVoice = browserVoices.some((voice) => {
    const voiceLang = voice.lang.toLowerCase();
    const voiceName = voice.name.toLowerCase();
    return voiceLang === 'km-kh'
      || voiceLang.startsWith('km')
      || voiceName.includes('khmer')
      || voiceName.includes('cambodian');
  });
  const khmerVoices = browserVoices.filter((voice) => {
    const voiceLang = voice.lang.toLowerCase();
    const voiceName = voice.name.toLowerCase();
    return voiceLang === 'km-kh'
      || voiceLang.startsWith('km')
      || voiceName.includes('khmer')
      || voiceName.includes('cambodian');
  });
  const englishVoices = browserVoices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <ToastHost />
      {automationNotice && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-800">
          <Sparkles size={18} className="shrink-0" />
          <span>{automationNotice}</span>
        </div>
      )}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-display font-bold text-brand-700 tracking-tight flex items-center gap-3">
            {t('videoVoiceTitle')}
            <VideoIcon className="text-brand-500" size={32} />
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1 text-lg">{t('videoVoiceSubtitle')}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {needsApiKey && (
            <button 
              onClick={handleOpenKeySelector}
              className="text-xs bg-crab-shell text-white px-6 py-3 rounded-full font-bold hover:bg-crab-shell/90 transition-all flex items-center gap-2 shadow-lg animate-bounce"
            >
              <Lock size={14} />
              {t('unlockPremiumAi')}
            </button>
          )}
          <div className="flex bg-brand-100/50 p-1.5 rounded-2xl border border-brand-200 backdrop-blur-sm">
            {[
              { id: 'video', label: t('videoCreator'), icon: VideoIcon },
              { id: 'voice', label: t('aiVoice'), icon: Mic },
            ].map((tool) => (
              <button 
                key={tool.id}
                onClick={() => setActiveTool(tool.id as ToolType)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 whitespace-nowrap",
                  activeTool === tool.id
                    ? "bg-white dark:bg-slate-800 text-brand-700 shadow-md scale-105"
                    : "text-brand-500 hover:text-brand-800"
                )}
              >
                <tool.icon size={18} />
                {tool.label}
              </button>
            ))}
          </div>
          <button 
            onClick={handleTikTokAuth}
            disabled={isAuthenticating}
            className={cn(
              "flex items-center gap-2 px-5 py-2.5 bg-black text-white rounded-xl text-sm font-bold hover:bg-slate-900 transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed",
              isAuthenticating && "animate-pulse"
            )}
          >
            {isAuthenticating ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" xmlns="http://www.w3.org/2000/svg">
                <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
              </svg>
            )}
            {tiktokUser ? `Connected: ${tiktokDisplayName}` : (isAuthenticating ? t('connecting') : t('connectTiktok'))}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <div className="lg:col-span-5 space-y-8">
          <div className="glass p-8 rounded-[2.5rem] space-y-6 relative overflow-hidden">
            {activeTool === 'video' ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('startingImageLabel')}</label>
                  <div className="flex flex-wrap gap-3">
                    {videoImages.map((image, index) => (
                      <div key={index} className="relative h-24 w-24 shrink-0">
                        <img
                          src={`data:${image.mimeType};base64,${image.base64}`}
                          alt="Preview"
                          className="h-full w-full object-cover rounded-xl"
                        />
                        <button
                          type="button"
                          onClick={() => setVideoImages((current) => current.filter((_, i) => i !== index))}
                          className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/80 text-white text-xs font-bold hover:bg-red-500 transition-colors"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {videoImages.length < MAX_VIDEO_IMAGES && (
                      <label className="flex h-24 w-24 shrink-0 flex-col items-center justify-center border-2 border-dashed border-brand-200 rounded-2xl bg-brand-50 hover:bg-brand-100 transition-all cursor-pointer">
                        <ImageIcon className="text-brand-300" size={28} />
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            e.target.value = '';
                            readImagesIntoState(files, MAX_VIDEO_IMAGES, videoImages.length, setVideoImages);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('sceneDescriptionLabel')}</label>
                    <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                      {['Khmer', 'English'].map(lang => (
                        <button key={lang} onClick={() => setVideoLanguage(lang as any)} className={cn("px-3 py-1 rounded-lg text-[10px] font-black", videoLanguage === lang ? "bg-white dark:bg-slate-800 text-brand-700 shadow-sm" : "text-brand-400")}>{lang}</button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    placeholder="Describe a realistic TikTok ad: product, location, camera movement, action, lighting, mood..."
                    className="w-full h-32 p-5 rounded-2xl bg-brand-50 border border-brand-200 outline-none transition-all resize-none shadow-inner"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('videoDurationLabel')}</label>
                  <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                    {VIDEO_LENGTH_OPTIONS.map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        onClick={() => setVideoDuration(seconds)}
                        className={cn(
                          'flex-1 px-3 py-2 rounded-lg text-xs font-black transition-all',
                          videoDuration === seconds
                            ? 'bg-white dark:bg-slate-800 text-brand-700 shadow-sm'
                            : 'text-brand-400 hover:text-brand-700'
                        )}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                </div>

                {/* Khmer Voice-over Section */}
                <div className="space-y-3 pt-4 border-t border-brand-100">
                  <button
                    type="button"
                    onClick={() => setVoiceOverEnabled(!voiceOverEnabled)}
                    className="w-full flex items-center justify-between"
                  >
                    <h4 className="text-sm font-bold text-brand-700 flex items-center gap-2">
                      <Mic size={16} className="text-brand-500" />
                      {t('voiceOverLabel')}
                    </h4>
                    <div className={cn(
                      "w-10 h-6 rounded-full transition-colors relative shrink-0",
                      voiceOverEnabled ? "bg-brand-600" : "bg-brand-100"
                    )}>
                      <div className={cn(
                        "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                        voiceOverEnabled ? "left-5" : "left-1"
                      )} />
                    </div>
                  </button>
                  {voiceOverEnabled && (
                    <div className="space-y-3">
                      <textarea
                        value={voiceOverText}
                        onChange={(e) => setVoiceOverText(e.target.value)}
                        placeholder={t('voiceOverPlaceholder')}
                        className="w-full h-24 p-4 rounded-xl bg-brand-50 border border-brand-200 outline-none text-sm resize-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
                      />
                      <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100 w-fit">
                        {[
                          { id: 'Female', label: language === 'km' ? 'សំឡេងស្រី' : 'Female' },
                          { id: 'Male', label: language === 'km' ? 'សំឡេងប្រុស' : 'Male' },
                        ].map((voice) => (
                          <button
                            key={voice.id}
                            type="button"
                            onClick={() => {
                              const nextGender = voice.id as VoiceGender;
                              setVoiceGender(nextGender);
                              setVoicePersona(nextGender === 'Male' ? 'piseth' : 'sreymom');
                            }}
                            className={cn(
                              "px-4 py-1.5 rounded-lg text-[10px] font-black transition-all",
                              voiceGender === voice.id ? "bg-white dark:bg-slate-800 text-brand-700 shadow-sm" : "text-brand-400 hover:text-brand-700"
                            )}
                          >
                            {voice.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Caption Generator Section */}
                <div className="space-y-4 pt-4 border-t border-brand-100">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-bold text-brand-700 flex items-center gap-2">
                      <Sparkles size={16} className="text-brand-500" />
                      {t('aiCaptionGenerator')}
                    </h4>
                    <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                      {['Khmer', 'English'].map(lang => (
                        <button key={lang} onClick={() => setCaptionLanguage(lang as any)} className={cn("px-3 py-1 rounded-lg text-[10px] font-black", captionLanguage === lang ? "bg-white dark:bg-slate-800 text-brand-700 shadow-sm" : "text-brand-400")}>{lang}</button>
                      ))}
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <textarea 
                      value={aiCaption} 
                      onChange={(e) => setAiCaption(e.target.value)} 
                      placeholder={t('captionPlaceholderVideoVoice')}
                      className="w-full h-24 p-4 rounded-xl bg-brand-50/50 border border-brand-100 outline-none text-sm resize-none italic text-brand-600"
                    />
                    <button 
                      onClick={handleGenerateCaption}
                      disabled={!videoPrompt || isGeneratingCaption}
                      className="w-full py-2.5 bg-brand-100 text-brand-700 rounded-xl text-xs font-bold hover:bg-brand-200 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isGeneratingCaption ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      {t('generateCaptionBtn')}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">{t('scriptTextLabel')}</label>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {language === 'km'
                      ? 'សរសេរខ្មែរ អង់គ្លេស ឬលាយគ្នា។ ប្រព័ន្ធនឹងអានតាមភាសាដែលមានក្នុងអត្ថបទ។'
                      : 'Write Khmer, English, or both. The app will read each language from your text.'}
                  </p>
                </div>
                <div className="flex justify-between items-end">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                    {language === 'km' ? 'ភេទសំឡេង' : 'Voice Type'}
                  </label>
                  <div className="flex bg-brand-50 p-1 rounded-xl border border-brand-100">
                    {[
                      { id: 'Female', label: language === 'km' ? 'សំឡេងស្រី' : 'Female' },
                      { id: 'Male', label: language === 'km' ? 'សំឡេងប្រុស' : 'Male' },
                    ].map(voice => (
                      <button
                        key={voice.id}
                        type="button"
                        onClick={() => {
                          const nextGender = voice.id as VoiceGender;
                          setVoiceGender(nextGender);
                          setVoicePersona(nextGender === 'Male' ? 'piseth' : 'sreymom');
                        }}
                        className={cn(
                          "px-4 py-1.5 rounded-lg text-[10px] font-black transition-all",
                          voiceGender === voice.id ? "bg-white dark:bg-slate-800 text-brand-700 shadow-sm" : "text-brand-400 hover:text-brand-700"
                        )}
                      >
                        {voice.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="hidden">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                      {language === 'km' ? 'ជ្រើសសំឡេងមនុស្ស' : 'Human Voice Persona'}
                    </label>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black text-emerald-700 border border-emerald-100">
                      {language === 'km' ? 'សំឡេងធម្មជាតិ' : 'Natural voice'}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.values(voicePersonas).map((persona) => (
                      <button
                        key={persona.id}
                        type="button"
                        onClick={() => {
                          setVoicePersona(persona.id);
                          setVoiceGender(persona.gender);
                        }}
                        className={cn(
                          "text-left rounded-2xl border p-4 transition-all min-h-[116px]",
                          voicePersona === persona.id
                            ? "border-brand-400 bg-white dark:bg-slate-800 shadow-lg ring-2 ring-brand-100"
                            : "border-brand-100 bg-brand-50/70 hover:bg-white dark:hover:bg-slate-800 hover:border-brand-300"
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-lg font-display font-black text-brand-700">{persona.name}</p>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-brand-400">
                              {persona.gender === 'Female'
                                ? (language === 'km' ? 'សំឡេងស្រី' : 'Female voice')
                                : (language === 'km' ? 'សំឡេងប្រុស' : 'Male voice')}
                            </p>
                          </div>
                          <div className={cn(
                            "h-9 w-9 rounded-xl flex items-center justify-center",
                            voicePersona === persona.id ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800 text-brand-500"
                          )}>
                            <Mic size={18} />
                          </div>
                        </div>
                        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{persona.description}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="hidden">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                      {language === 'km' ? 'សំឡេងខ្មែរ' : 'Khmer Voice'}
                    </span>
                    <select
                      value={selectedKhmerVoiceURI}
                      onChange={(event) => setSelectedKhmerVoiceURI(event.target.value)}
                      className="w-full rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 outline-none"
                    >
                      <option value="">
                        {khmerVoices.length
                          ? (language === 'km' ? 'ជ្រើសដោយស្វ័យប្រវត្តិ' : 'Auto select')
                          : (language === 'km' ? 'មិនមាន Khmer voice ក្នុង browser' : 'No Khmer voice detected')}
                      </option>
                      {khmerVoices.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">
                      {language === 'km' ? 'សំឡេងអង់គ្លេស' : 'English Voice'}
                    </span>
                    <select
                      value={selectedEnglishVoiceURI}
                      onChange={(event) => setSelectedEnglishVoiceURI(event.target.value)}
                      className="w-full rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 outline-none"
                    >
                      <option value="">{language === 'km' ? 'ជ្រើសដោយស្វ័យប្រវត្តិ' : 'Auto select'}</option>
                      {englishVoices.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} className="w-full h-48 p-4 rounded-2xl bg-brand-50 border border-brand-200 outline-none transition-all resize-none" />
                <p className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3 text-xs font-semibold text-brand-700">
                  {language === 'km'
                    ? 'បញ្ចូលអត្ថបទខ្មែរ ឬអង់គ្លេស។ App នឹងព្យាយាមអានតាមភាសានៅក្នុងអត្ថបទដោយសំឡេងមនុស្សធម្មជាតិ។'
                    : 'Enter Khmer or English text. The app will read it with the most natural available human voice.'}
                </p>
                {false && ttsText && /[\u1780-\u17FF]/.test(ttsText) && !hasKhmerVoice && (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                    {language === 'km'
                      ? 'Chrome/Windows របស់អ្នកមិនឃើញមាន Khmer voice ទេ។ ប្រសិនបើវានៅតែអានជាអង់គ្លេស សូមដំឡើង Khmer language/voice ក្នុង Windows Settings ឬប្រើ browser/device ដែលមាន Khmer TTS។'
                      : 'No Khmer browser voice was detected. If Khmer still reads with an English accent, install a Khmer language/voice in Windows Settings or use a browser/device with Khmer TTS.'}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={() => {
                if (activeTool === 'video') {
                  void handleGenerateVideo();
                } else {
                  void handleGenerateAudio();
                }
              }}
              className="w-full bg-gradient-to-r from-brand-600 to-crab-shell text-white font-bold py-5 rounded-2xl flex items-center justify-center gap-3 shadow-xl"
            >
              {loading || audioLoading ? <Loader2 className="animate-spin" /> : <Sparkles size={22} />}
              <span className="text-lg">{loading || audioLoading ? t('generating') : t('generateWithAi')}</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="glass p-8 rounded-[2.5rem] min-h-[600px] flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-bold text-brand-700 flex items-center gap-2">
                <div className="w-2 h-6 bg-brand-500 rounded-full" />
                {t('aiGenerationResult')}
              </h3>
              {(generatedVideo || generatedAudio || voiceFallbackMessage) && (
                <button onClick={handleDownload} className="p-3 bg-brand-50 text-brand-500 hover:bg-brand-100 rounded-xl transition-all border border-brand-200">
                  <Download size={20} />
                </button>
              )}
            </div>
            <div className="flex-1 flex flex-col items-center justify-center">
              {loading || audioLoading ? (
                <div className="text-center space-y-4">
                  <Loader2 className="w-12 h-12 animate-spin text-brand-600 mx-auto" />
                  <p className="text-brand-700 font-bold">
                    {watermarking
                      ? t('addingLogo')
                      : addingVoiceOver
                        ? t('addingVoiceOver')
                        : mergingSegments
                          ? t('mergingSegments')
                          : segmentProgress
                            ? `${t('generatingSegmentPrefix')} ${segmentProgress.current} ${t('generatingSegmentJoiner')} ${segmentProgress.total}`
                            : t('craftingContent')}
                  </p>
                </div>
              ) : activeTool === 'video' && generatedVideo ? (
                <div className="w-full space-y-6">
                  {videoVoiceQualityNotice && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
                      {videoVoiceQualityNotice}
                    </div>
                  )}
                  <video src={generatedVideo} controls className="w-full rounded-3xl shadow-2xl" />
                  <div className="flex gap-4">
                    {tiktokUser ? (
                      <button 
                        onClick={() => handlePostToTikTok(generatedVideo!)}
                        disabled={isPostingTikTok}
                        className="flex-1 bg-black text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl hover:bg-slate-900 transition-all disabled:opacity-50"
                      >
                        {isPostingTikTok ? <Loader2 size={20} className="animate-spin" /> : (
                          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                          </svg>
                        )}
                        {t('postToTiktok')} {tiktokUser ? `(@${tiktokDisplayName})` : ''}
                      </button>
                    ) : (
                      <button 
                        onClick={handleTikTokAuth}
                        disabled={isAuthenticating}
                        className="flex-1 bg-brand-600 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl hover:bg-brand-700 transition-all disabled:opacity-50"
                      >
                        {isAuthenticating ? <Loader2 size={20} className="animate-spin" /> : (
                          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.06 3.42-.01 6.83-.02 10.25-.17 4.14-4.23 7.25-8.26 6.5-3.94-.73-6.47-5.11-4.67-8.73 1.14-2.2 3.86-3.54 6.32-3.14.05 1.58 0 3.16 0 4.74-1.57-.14-3.29.35-4.23 1.71-.96 1.39-.64 3.55.75 4.53 1.38.97 3.56.64 4.53-.75.28-.38.39-.84.41-1.3.02-3.58 0-7.17.01-10.75 0-2.87 0-5.74 0-8.61z"/>
                          </svg>
                        )}
                        {t('connectTiktok')}
                      </button>
                    )}
                    <button
                      onClick={handleScheduleThisVideo}
                      className="p-4 bg-brand-100 text-brand-700 rounded-2xl hover:bg-brand-200 transition-all border border-brand-200"
                      title="Schedule for later"
                    >
                      <Calendar size={24} />
                    </button>
                  </div>
                </div>
              ) : activeTool === 'voice' && (generatedAudio || voiceFallbackMessage) ? (
                <div className="text-center space-y-6">
                  <Volume2 size={64} className="text-brand-600 mx-auto" />
                  {generatedAudio ? (
                    <audio src={generatedAudio} controls className="w-full" />
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-800 space-y-4">
                      <p>{voiceFallbackMessage}</p>
                      <div className="flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => speakWithBrowserVoice()}
                          className="rounded-xl bg-brand-700 px-4 py-2 text-white hover:bg-brand-800 transition-all"
                        >
                          {language === 'km' ? 'ចាក់សំឡេងម្ដងទៀត' : 'Play again'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownload}
                          className="rounded-xl border border-brand-300 bg-white dark:bg-slate-800 px-4 py-2 text-brand-700 hover:bg-brand-50 dark:hover:bg-slate-700 transition-all inline-flex items-center gap-2"
                        >
                          <Download size={16} />
                          {language === 'km' ? 'ទាញយកអត្ថបទសំឡេង' : 'Download script'}
                        </button>
                        <button
                          type="button"
                          onClick={stopBrowserVoice}
                          className="rounded-xl border border-amber-300 bg-white dark:bg-slate-800 px-4 py-2 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-slate-700 transition-all"
                        >
                          {language === 'km' ? 'បញ្ឈប់សំឡេង' : 'Stop voice'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-brand-300 space-y-4">
                  <Sparkles size={48} className="mx-auto" />
                  <p>{t('yourAiContentWillAppear')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoVoice;
