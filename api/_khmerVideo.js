import { generateOpenRouterImage, startOpenRouterVideo } from './_openrouter.js';
import { generateKhmerSpeech } from './_khmerNarration.js';
import {
  assertVideoGenerationWithinBudget,
  BUDGET_AVATAR_IMAGE_MODEL,
  KHMER_VIDEO_MODEL,
  STANDARD_VIDEO_MODEL,
} from '../shared/videoCost.js';

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
  const narrationAudio = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
  if (!(narrationAudio.duration > 0 && narrationAudio.duration <= duration)) throw new Error('Khmer narration must fit within the clip. Shorten the script.');
  const job = await startOpenRouterVideo({
    // Mini retains image/audio reference support while keeping an 8-second
    // Khmer presenter video (including avatar + narration reserve) under $0.80.
    model: KHMER_VIDEO_MODEL,
    khmerSpeech: true,
    prompt: `${speech.prompt}\n${speech.motionPrompt}\nFINAL TIMING OVERRIDE: The reference audio lasts ${narrationAudio.duration.toFixed(2)} seconds and is the master clock. Begin mouth articulation on its first audible phoneme—not before or after—and reproduce its pauses exactly. Keep the jaw, lips and cheeks synchronized frame by frame; never add idle mouth movement. Do not stretch the speech, facial motion or gestures to fill the ${duration}-second clip. At the last audible phoneme, close the mouth naturally and hold an attentive expression. Playback is real-time 1x speed; gestures are brisk and compact, with no slow motion, prolonged movement or dramatic pause.`,
    duration,
    referenceUrls: [avatarImage.mediaUrl],
    audioReferenceUrls: [narrationAudio.mediaUrl],
  });
  return {
    job,
    avatarImage,
    narrationAudio: {
      ...narrationAudio,
      provider: audio.provider || audio.model || 'unknown',
      fallbackReason: audio.fallbackReason || '',
      spokenText: audio.spokenText || speech.script,
    },
  };
};

