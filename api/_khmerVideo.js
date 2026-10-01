import { generateOpenRouterImage, startOpenRouterVideo } from './_openrouter.js';
import { expandGeneratedKhmerNarration, generateKhmerSpeech, shortenGeneratedKhmerNarration } from './_khmerNarration.js';
import { trimVideoNarrationSilence } from './_videoNarrationTiming.js';
import {
  assertVideoGenerationWithinBudget,
  BUDGET_AVATAR_IMAGE_MODEL,
  KHMER_VIDEO_MODEL,
  STANDARD_VIDEO_MODEL,
} from '../shared/videoCost.js';
import { getOriginalImageKitUrl } from '../shared/imageKitUrl.js';

const MIN_KHMER_CLIP_DURATION = 4;
const MAX_KHMER_CLIP_DURATION = 8;
// Generated lettering is not a reliable way to render Khmer. This path is
// shared by scheduled and interactive clips and bypasses ai.js's visual prompt.
const visualPrompt = (prompt = '') => `${prompt}\nVISUAL TEXT RULE: Do not generate readable text, invented letters, subtitles or captions anywhere. Show computer and phone screens as clean icon-based interfaces, charts and colored blocks without text; show documents, labels and signs as blank surfaces. Never paint the spoken transcript into the scene. Preserve an existing supplied logo without inventing or changing its lettering. Exact text must be added separately with a real font renderer.`;

export const fitKhmerClipDurationToNarration = (narrationDuration, requestedDuration) => {
  const requested = [4, 6, 8].includes(Number(requestedDuration)) ? Number(requestedDuration) : 8;
  // Seedance supports every whole-second duration from 4 through 15, unlike
  // Veo's fixed 4/6/8 choices. Honor the user's chosen length; only expand a
  // shorter choice when the measured narration needs more room.
  const measured = Number(narrationDuration);
  if (!Number.isFinite(measured) || measured <= 0) return requested;
  const fitted = Math.max(requested, MIN_KHMER_CLIP_DURATION, Math.ceil(measured + 0.05));
  return Math.min(MAX_KHMER_CLIP_DURATION, fitted);
};

export const startKhmerVideoJob = async (item, speech, uploadMediaDataUrl, {
  duration = 8,
  images = [],
  aspectRatio = item.aspectRatio || '9:16',
  generateAudio,
  allowScriptShortening = false,
} = {}) => {
  const hasKhmerSpeech = speech.mode !== 'silent';
  assertVideoGenerationWithinBudget({
    duration,
    khmerSpeech: hasKhmerSpeech,
    model: hasKhmerSpeech ? KHMER_VIDEO_MODEL : STANDARD_VIDEO_MODEL,
  });
  if (speech.mode === 'silent') {
    return { job: await startOpenRouterVideo({ prompt: visualPrompt(speech.prompt), duration, aspectRatio }), avatarImage: null };
  }
  let spokenScript = speech.script;
  let scriptShortened = false;
  if (allowScriptShortening && /[A-Za-z]{2,}/.test(spokenScript)) {
    spokenScript = await shortenGeneratedKhmerNarration(spokenScript, item.businessName, duration === 8 ? 85 : 55);
    // The 8-second rewrite transliterates the brand without forcing a short
    // line; leave the overlong-audio retry available after measuring it.
    scriptShortened = duration !== 8;
  }
  const speechOptions = {
    input: spokenScript,
    voice: item.voiceGender || 'Female',
    performanceStyle: speech.performanceStyle || item.performanceStyle || '',
    context: item.prompt || speech.prompt || '',
    targetDuration: duration,
  };

  let audio = await trimVideoNarrationSilence(await generateKhmerSpeech(speechOptions));
  let uploadedNarration;
  let measuredDuration = Number(audio.duration);
  if (!(measuredDuration > 0) || measuredDuration <= MAX_KHMER_CLIP_DURATION) {
    uploadedNarration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
    measuredDuration = Number(audio.duration || uploadedNarration.duration);
  }

  // Content-plan and scanner scripts are AI-authored. If the first read ends
  // well before an 8-second clip, try one fuller script before paying for the
  // video. Never rewrite manually supplied narration or replace a usable read
  // with a second take that is too long or no fuller than the first.
  if (allowScriptShortening && duration === 8 && measuredDuration > 0 && measuredDuration < 6) {
    try {
      const expandedScript = await expandGeneratedKhmerNarration(spokenScript, item.businessName, measuredDuration);
      if (expandedScript && expandedScript !== spokenScript) {
        const expandedAudio = await trimVideoNarrationSilence(await generateKhmerSpeech({ ...speechOptions, input: expandedScript }));
        let expandedDuration = Number(expandedAudio.duration);
        let expandedUpload;
        if (!(expandedDuration > 0) || expandedDuration <= MAX_KHMER_CLIP_DURATION) {
          expandedUpload = await uploadMediaDataUrl({ mediaDataUrl: expandedAudio.audioUrl, mediaType: 'audio' });
          expandedDuration = Number(expandedAudio.duration || expandedUpload.duration);
        }
        if (expandedDuration > measuredDuration + 0.5 && expandedDuration <= MAX_KHMER_CLIP_DURATION) {
          spokenScript = expandedScript;
          speechOptions.input = expandedScript;
          audio = expandedAudio;
          uploadedNarration = expandedUpload;
          measuredDuration = expandedDuration;
        }
      }
    } catch (error) {
      console.warn('Could not expand short content-plan narration; keeping the verified original:', error?.message || error);
    }
  }

  if (measuredDuration > MAX_KHMER_CLIP_DURATION && allowScriptShortening && !scriptShortened) {
    spokenScript = await shortenGeneratedKhmerNarration(spokenScript, item.businessName, 45);
    speechOptions.input = spokenScript;
    audio = await trimVideoNarrationSilence(await generateKhmerSpeech(speechOptions));
    measuredDuration = Number(audio.duration);
    uploadedNarration = undefined;
    scriptShortened = true;
    if (!(measuredDuration > 0) || measuredDuration <= MAX_KHMER_CLIP_DURATION) {
      uploadedNarration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
      measuredDuration = Number(audio.duration || uploadedNarration.duration);
    }
  }

  // Keep every word. If the expressive voice (or the normal Edge fallback)
  // exceeds the hard budget, retry the same script once with a measured,
  // pitch-preserving neural speech-rate increase before any paid image/video
  // preparation starts.
  if (measuredDuration > MAX_KHMER_CLIP_DURATION) {
    const currentRateFactor = /edge-/i.test(String(audio.provider || audio.model || '')) ? 1.12 : 1;
    const requiredRatePercent = Math.min(35, Math.max(14,
      Math.ceil(((currentRateFactor * measuredDuration) / (MAX_KHMER_CLIP_DURATION - 0.15) - 1) * 100) + 2));
    audio = await trimVideoNarrationSilence(await generateKhmerSpeech({
      ...speechOptions,
      forceEdge: true,
      edgeRate: `+${requiredRatePercent}%`,
    }));
    uploadedNarration = await uploadMediaDataUrl({ mediaDataUrl: audio.audioUrl, mediaType: 'audio' });
    measuredDuration = Number(audio.duration || uploadedNarration.duration);
  }

  const narrationAudio = { ...uploadedNarration, duration: measuredDuration };
  if (!(narrationAudio.duration > 0 && narrationAudio.duration <= MAX_KHMER_CLIP_DURATION)) throw new Error('Khmer narration exceeds the maximum 8-second clip. Use a longer video workflow or adjust the delivery pace.');
  const fittedDuration = fitKhmerClipDurationToNarration(narrationAudio.duration, duration);
  assertVideoGenerationWithinBudget({ duration: fittedDuration, khmerSpeech: true, model: KHMER_VIDEO_MODEL });
  const image = images.length
    ? { imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` }
    : await generateOpenRouterImage({ prompt: visualPrompt(speech.avatarPrompt), aspectRatio, model: BUDGET_AVATAR_IMAGE_MODEL });
  const avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
  const avatarReferenceUrl = getOriginalImageKitUrl(avatarImage.mediaUrl, process.env.IMAGEKIT_URL_ENDPOINT || '');
  const exactKhmerTranscript = String(narrationAudio.spokenText || spokenScript || '').trim();
  const job = await startOpenRouterVideo({
    // Mini retains image/audio reference support while keeping an 8-second
    // Khmer presenter video (including avatar + narration reserve) under $0.80.
    model: KHMER_VIDEO_MODEL,
    khmerSpeech: true,
    prompt: `${visualPrompt(speech.prompt)}\n${speech.motionPrompt}\nLANGUAGE LOCK: The English wording in these production directions describes visuals only. Never infer, invent, speak, or visibly articulate any English word. The only speech and mouth movement is Cambodian Khmer from the supplied audio waveform. KHMER PHONEME TRANSCRIPT (exact, never translate or paraphrase): ${JSON.stringify(exactKhmerTranscript)}. AUDIO MASTER CLOCK: ${narrationAudio.duration.toFixed(2)} seconds inside a ${fittedDuration}-second clip. The supplied waveform is authoritative: start the matching visible mouth shape on every Khmer phoneme and stop precisely on the last phoneme. ZERO-LATENCY LIP SYNC: each mouth shape must open or close on the exact same frame as its matching phoneme's sound, never one or more frames after it. A mouth that is still closed, still opening, or still mid-transition after its phoneme is already audible is a failure. Do not let the lips lag, trail, drift behind, catch up to, or echo the audio at any point in the clip -- re-anchor to the waveform every phoneme rather than letting a small delay accumulate over the clip. Speech, lips, jaw, tongue and cheeks remain synchronized frame by frame at natural 1x. Do not use generic talking-mouth animation. Keep the lips closed before the first phoneme and after the final phoneme. Keep the head mostly forward and stable. Body and hand reactions use crisp fast-natural 1.1x energy without motion blur. Complete each gesture in 0.35 to 0.55 seconds. After speech, continue natural task actions at a normal pace until the full clip ends. Never freeze, stretch, ease or slow any movement.`,
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
      spokenText: audio.spokenText || spokenScript,
    },
  };
};

