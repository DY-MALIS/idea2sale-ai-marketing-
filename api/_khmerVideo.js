import { generateOpenRouterImage, startOpenRouterVideo } from './_openrouter.js';
import { generateKhmerSpeech } from './_khmerNarration.js';
import {
  assertVideoGenerationWithinBudget,
  BUDGET_AVATAR_IMAGE_MODEL,
  KHMER_VIDEO_MODEL,
  STANDARD_VIDEO_MODEL,
} from '../shared/videoCost.js';
import { getOriginalImageKitUrl } from '../shared/imageKitUrl.js';

const KHMER_CLIP_DURATIONS = [4, 6, 8];

export const fitKhmerClipDurationToNarration = (narrationDuration, requestedDuration) => {
  const maximum = KHMER_CLIP_DURATIONS.includes(Number(requestedDuration)) ? Number(requestedDuration) : 8;
  // Leave only a short natural settling beat after the final phoneme. A short
  // sentence inside an eight-second clip otherwise makes the model stretch
  // ordinary gestures into conspicuous AI slow motion.
  return KHMER_CLIP_DURATIONS.find((seconds) => seconds <= maximum && seconds >= narrationDuration + 0.15)
    || maximum;
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
  const image = images.length
    ? { imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` }
    : await generateOpenRouterImage({ prompt: speech.avatarPrompt, aspectRatio, model: BUDGET_AVATAR_IMAGE_MODEL });
  const avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
  const avatarReferenceUrl = getOriginalImageKitUrl(avatarImage.mediaUrl, process.env.IMAGEKIT_URL_ENDPOINT || '');
  const audio = await generateKhmerSpeech({
    input: speech.script,
    voice: item.voiceGender || 'Female',
    performanceStyle: speech.performanceStyle || item.performanceStyle || '',
    context: item.prompt || speech.prompt || '',
  });
  const uploadedNarration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
  const narrationAudio = {
    ...uploadedNarration,
    duration: Number(audio.duration || uploadedNarration.duration),
  };
  if (!(narrationAudio.duration > 0 && narrationAudio.duration <= duration)) throw new Error('Khmer narration must fit within the clip. Shorten the script.');
  const fittedDuration = fitKhmerClipDurationToNarration(narrationAudio.duration, duration);
  const job = await startOpenRouterVideo({
    // Mini retains image/audio reference support while keeping an 8-second
    // Khmer presenter video (including avatar + narration reserve) under $0.80.
    model: KHMER_VIDEO_MODEL,
    khmerSpeech: true,
    prompt: `${speech.prompt}\n${speech.motionPrompt}\nAUDIO MASTER CLOCK: ${narrationAudio.duration.toFixed(2)} seconds inside a ${fittedDuration}-second clip. The supplied waveform is authoritative: start the matching visible mouth shape on every phoneme and stop precisely on the last phoneme. Speech, lips, jaw and cheeks remain synchronized frame by frame at natural 1x. Keep the head mostly forward and stable. Body and hand reactions use crisp fast-natural 1.1x energy without motion blur. Complete each gesture in 0.35 to 0.55 seconds. After speech, continue one compact task action without pausing. Never freeze, stretch, ease or slow any movement.`,
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

