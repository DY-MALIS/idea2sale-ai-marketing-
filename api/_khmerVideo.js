import { generateOpenRouterImage, startOpenRouterVideo } from './_openrouter.js';
import { generateKhmerSpeech } from './_khmerNarration.js';

export const startKhmerVideoJob = async (item, speech, uploadMediaDataUrl, { duration = 8, images = [] } = {}) => {
  if (speech.mode === 'silent') {
    return { job: await startOpenRouterVideo({ prompt: speech.prompt, duration }), avatarImage: null };
  }
  const image = images.length ? { imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` } : await generateOpenRouterImage({ prompt: speech.avatarPrompt, aspectRatio: '16:9' });
  const avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
  const audio = await generateKhmerSpeech({ input: speech.script, voice: item.voiceGender || 'Female' });
  const narrationAudio = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
  if (!(narrationAudio.duration > 0 && narrationAudio.duration <= duration)) throw new Error('Khmer narration must fit within the clip. Shorten the script.');
  const job = await startOpenRouterVideo({
    // The former :free route can remain listed while having no live provider
    // endpoint. Mini keeps the same image/audio-reference workflow and is the
    // lowest-cost currently available Seedance 2.0 route.
    model: process.env.OPEN_ROUTER_KHMER_VIDEO_MODEL || 'bytedance/seedance-2.0-mini',
    prompt: `${speech.prompt}\n${speech.motionPrompt}\nTIMING: The reference audio lasts ${narrationAudio.duration.toFixed(2)} seconds. Start speaking at the beginning and follow its original word timing exactly. Do not stretch the speech or gestures to fill the ${duration}-second clip. Once the audio ends, close the mouth and maintain an attentive natural expression. Real-time motion at normal conversational speed; no slow motion, prolonged hand movements or long pauses.`,
    duration,
    referenceUrls: [avatarImage.mediaUrl],
    audioReferenceUrls: [narrationAudio.mediaUrl],
  });
  return { job, avatarImage, narrationAudio };
};

