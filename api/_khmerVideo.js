import { generateOpenRouterImage, startOpenRouterVideo } from './_openrouter.js';
import { generateKhmerSpeech } from './_khmerNarration.js';
import {
  assertVideoGenerationWithinBudget,
  BUDGET_AVATAR_IMAGE_MODEL,
  KHMER_VIDEO_MODEL,
  STANDARD_VIDEO_MODEL,
} from '../shared/videoCost.js';
import { getOriginalImageKitUrl } from '../shared/imageKitUrl.js';

const MIN_KHMER_CLIP_DURATION = 4;
const MAX_KHMER_CLIP_DURATION = 8;

export const fitKhmerClipDurationToNarration = (narrationDuration, requestedDuration) => {
  const requested = [4, 6, 8].includes(Number(requestedDuration)) ? Number(requestedDuration) : 8;
  // Seedance supports every whole-second duration from 4 through 15, unlike
  // Veo's fixed 4/6/8 choices. Size the clip from the measured waveform: this
  // preserves the user's exact words, leaves a short settling beat, and avoids
  // stretching a short read across an unnecessarily long requested clip.
  const measured = Number(narrationDuration);
  if (!Number.isFinite(measured) || measured <= 0) return requested;
  const fitted = Math.max(MIN_KHMER_CLIP_DURATION, Math.ceil(measured + 0.15));
  return Math.min(MAX_KHMER_CLIP_DURATION, fitted);
};

export const startKhmerVideoJob = async (item, speech, uploadMediaDataUrl, {
  duration = 8,
  images = [],
  aspectRatio = item.aspectRatio || '9:16',
  generateAudio,
} = {}) => {
  const hasKhmerSpeech = speech.mode !== 'silent';
  assertVideoGenerationWithinBudget({
    duration,
    khmerSpeech: hasKhmerSpeech,
    model: hasKhmerSpeech ? KHMER_VIDEO_MODEL : STANDARD_VIDEO_MODEL,
  });
  if (speech.mode === 'silent') {
    return { job: await startOpenRouterVideo({ prompt: speech.prompt, duration, aspectRatio }), avatarImage: null };
  }
  const speechOptions = {
    input: speech.script,
    voice: item.voiceGender || 'Female',
    performanceStyle: speech.performanceStyle || item.performanceStyle || '',
    context: item.prompt || speech.prompt || '',
    targetDuration: duration,
  };

  let audio = await generateKhmerSpeech(speechOptions);
  let uploadedNarration;
  let measuredDuration = Number(audio.duration);
  if (!(measuredDuration > 0) || measuredDuration <= MAX_KHMER_CLIP_DURATION) {
    uploadedNarration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
    measuredDuration = Number(audio.duration || uploadedNarration.duration);
  }

  // Keep every word. If the expressive voice (or the normal Edge fallback)
  // exceeds the hard budget, retry the same script once with a measured,
  // pitch-preserving neural speech-rate increase before any paid image/video
  // preparation starts.
  if (measuredDuration > MAX_KHMER_CLIP_DURATION) {
    const currentRateFactor = /edge-/i.test(String(audio.provider || audio.model || '')) ? 1.12 : 1;
    const requiredRatePercent = Math.min(35, Math.max(14,
      Math.ceil(((currentRateFactor * measuredDuration) / (MAX_KHMER_CLIP_DURATION - 0.15) - 1) * 100) + 2));
    audio = await generateKhmerSpeech({
      ...speechOptions,
      forceEdge: true,
      edgeRate: `+${requiredRatePercent}%`,
    });
    uploadedNarration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
    measuredDuration = Number(audio.duration || uploadedNarration.duration);
  }

  const narrationAudio = { ...uploadedNarration, duration: measuredDuration };
  if (!(narrationAudio.duration > 0 && narrationAudio.duration <= MAX_KHMER_CLIP_DURATION)) throw new Error('Khmer narration exceeds the maximum 8-second clip. Use a longer video workflow or adjust the delivery pace.');
  const fittedDuration = fitKhmerClipDurationToNarration(narrationAudio.duration, duration);
  assertVideoGenerationWithinBudget({ duration: fittedDuration, khmerSpeech: true, model: KHMER_VIDEO_MODEL });
  const image = images.length
    ? { imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` }
    : await generateOpenRouterImage({ prompt: speech.avatarPrompt, aspectRatio, model: BUDGET_AVATAR_IMAGE_MODEL });
  const avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
  const avatarReferenceUrl = getOriginalImageKitUrl(avatarImage.mediaUrl, process.env.IMAGEKIT_URL_ENDPOINT || '');
  const exactKhmerTranscript = String(narrationAudio.spokenText || speech.script || '').trim();
  const job = await startOpenRouterVideo({
    // Mini retains image/audio reference support while keeping an 8-second
    // Khmer presenter video (including avatar + narration reserve) under $0.80.
    model: KHMER_VIDEO_MODEL,
    khmerSpeech: true,
    prompt: `${speech.prompt}\n${speech.motionPrompt}\nLANGUAGE LOCK: The English wording in these production directions describes visuals only. Never infer, invent, speak, or visibly articulate any English word. The only speech and mouth movement is Cambodian Khmer from the supplied audio waveform. KHMER PHONEME TRANSCRIPT (exact, never translate or paraphrase): ${JSON.stringify(exactKhmerTranscript)}. AUDIO MASTER CLOCK: ${narrationAudio.duration.toFixed(2)} seconds inside a ${fittedDuration}-second clip. The supplied waveform is authoritative: start the matching visible mouth shape on every Khmer phoneme and stop precisely on the last phoneme. Speech, lips, jaw, tongue and cheeks remain synchronized frame by frame at natural 1x. Do not use generic talking-mouth animation. Keep the lips closed before the first phoneme and after the final phoneme. Keep the head mostly forward and stable. Body and hand reactions use crisp fast-natural 1.1x energy without motion blur. Complete each gesture in 0.35 to 0.55 seconds. After speech, continue one compact task action without pausing. Never freeze, stretch, ease or slow any movement.`,
    duration: fittedDuration,
    aspectRatio,
    referenceUrls: [avatarReferenceUrl],
    audioReferenceUrls: [narrationAudio.mediaUrl],
    generateAudio,
  });
  return {
    job: { ...job, outputDuration: fittedDuration },
    avatarImage,
    narrationAudio: {
      ...narrationAudio,
      provider: audio.provider || audio.model || 'unknown',
      fallbackReason: audio.fallbackReason || '',
      spokenText: audio.spokenText || speech.script,
    },
  };
};

