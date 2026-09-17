import { generateOpenRouterImage, startOpenRouterVideo } from './_openrouter.js';
import { generateKhmerSpeech } from './_khmerNarration.js';
import {
  assertVideoGenerationWithinBudget,
  BUDGET_AVATAR_IMAGE_MODEL,
  KHMER_VIDEO_MODEL,
  STANDARD_VIDEO_MODEL,
} from '../shared/videoCost.js';

const KHMER_CLIP_DURATIONS = [4, 6, 8];

export const fitKhmerClipDurationToNarration = (narrationDuration, requestedDuration) => {
  const maximum = KHMER_CLIP_DURATIONS.includes(Number(requestedDuration)) ? Number(requestedDuration) : 8;
  // Leave only a short natural settling beat after the final phoneme. A short
  // sentence inside an eight-second clip otherwise makes the model stretch
  // ordinary gestures into conspicuous AI slow motion.
  return KHMER_CLIP_DURATIONS.find((seconds) => seconds <= maximum && seconds >= narrationDuration + 0.15)
    || maximum;
};

export const startKhmerVideoJob = async (item, speech, uploadMediaDataUrl, { duration = 8, images = [] } = {}) => {
  const hasKhmerSpeech = speech.mode !== 'silent';
  assertVideoGenerationWithinBudget({
    duration,
    khmerSpeech: hasKhmerSpeech,
    model: hasKhmerSpeech ? KHMER_VIDEO_MODEL : STANDARD_VIDEO_MODEL,
  });
  if (speech.mode === 'silent') {
    return { job: await startOpenRouterVideo({ prompt: speech.prompt, duration }), avatarImage: null };
  }
  const image = images.length
    ? { imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` }
    : await generateOpenRouterImage({ prompt: speech.avatarPrompt, aspectRatio: '16:9', model: BUDGET_AVATAR_IMAGE_MODEL });
  const avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
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
    prompt: `${speech.prompt}\n${speech.motionPrompt}\nFINAL TIMING OVERRIDE: The reference audio lasts ${narrationAudio.duration.toFixed(2)} seconds and is the master clock. Begin mouth articulation on its first audible phoneme—not before or after—and reproduce its pauses exactly. Keep the jaw, lips and cheeks synchronized frame by frame; never add idle mouth movement. Do not stretch the speech, facial motion or gestures to fill the ${fittedDuration}-second clip. At the last audible phoneme, close the mouth naturally, then continue one small context-relevant task action at ordinary real-world speed for any remaining time; do not freeze, pose or draw out the movement. Playback is real-time 1x speed; gestures are brisk and compact, with no slow motion, prolonged movement, cinematic easing or dramatic pause.`,
    duration: fittedDuration,
    referenceUrls: [avatarImage.mediaUrl],
    audioReferenceUrls: [narrationAudio.mediaUrl],
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

