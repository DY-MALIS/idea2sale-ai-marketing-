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
  // The provider can animate a talking mouth throughout a requested 8-second
  // clip even when the supplied narration ends after only a few seconds.
  // Bound the speaking shot to the measured waveform instead of leaving a
  // long silent tail with continuing mouth motion. A longer narration can
  // still expand a shorter requested clip within the eight-second cost cap.
  const measured = Number(narrationDuration);
  if (!Number.isFinite(measured) || measured <= 0) return requested;
  const fitted = Math.max(MIN_KHMER_CLIP_DURATION, Math.ceil(measured + 0.05));
  return Math.min(MAX_KHMER_CLIP_DURATION, fitted);
};

export const startKhmerVideoJob = async (item, speech, uploadMediaDataUrl, {
  duration = 8,
  images = [],
  aspectRatio = item.aspectRatio || '9:16',
  generateAudio,
  allowScriptShortening = false,
} = {}) => {
  const preparationStartedAt = Date.now();
  const hasKhmerSpeech = speech.mode !== 'silent';
  assertVideoGenerationWithinBudget({
    duration,
    khmerSpeech: hasKhmerSpeech,
    model: hasKhmerSpeech ? KHMER_VIDEO_MODEL : STANDARD_VIDEO_MODEL,
  });
  if (speech.mode === 'silent') {
    return { job: await startOpenRouterVideo({ prompt: visualPrompt(speech.prompt), duration, aspectRatio }), avatarImage: null };
  }
  // Start the avatar image now, in parallel with the narration pipeline below
  // -- it only depends on speech.avatarPrompt/aspectRatio/images, none of
  // which involve narration audio at all, so there's no reason the (often
  // slow, sometimes multi-step: TTS, duration-fit retries, expand/shorten
  // rewrites) narration work below should block it from starting. Awaited
  // just before it's actually needed, right after the narration pipeline
  // finishes and fittedDuration is known.
  const imagePromise = (images.length
    ? Promise.resolve({ imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` })
    : generateOpenRouterImage({ prompt: visualPrompt(speech.avatarPrompt), aspectRatio, model: BUDGET_AVATAR_IMAGE_MODEL, timeoutMs: 75_000 }))
    // Attach the rejection handler immediately. Narration may take minutes,
    // and an image request that fails before the later await would otherwise
    // become an unhandled rejection and could terminate the function.
    .then((image) => ({ image }), (error) => ({ error }));

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
  if (allowScriptShortening && duration === 8 && measuredDuration > 0 && measuredDuration < 6
    && Date.now() - preparationStartedAt < 90_000) {
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
  const imageResult = await imagePromise;
  if ('error' in imageResult) throw imageResult.error;
  const image = imageResult.image;
  const avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
  const avatarReferenceUrl = getOriginalImageKitUrl(avatarImage.mediaUrl, process.env.IMAGEKIT_URL_ENDPOINT || '');
  const exactKhmerTranscript = String(narrationAudio.spokenText || spokenScript || '').trim();
  const videoRequest = {
    // Mini retains image/audio reference support while keeping an 8-second
    // Khmer presenter video (including avatar + narration reserve) under $0.80.
    model: KHMER_VIDEO_MODEL,
    khmerSpeech: true,
    prompt: `${visualPrompt(speech.prompt)}\n${speech.motionPrompt}\nLANGUAGE LOCK: The English wording in these production directions describes visuals only. Never infer, invent, speak, or visibly articulate any English word. The only speech and mouth movement is Cambodian Khmer from the supplied audio waveform. KHMER PHONEME TRANSCRIPT (exact, never translate or paraphrase): ${JSON.stringify(exactKhmerTranscript)}. AUDIO MASTER CLOCK: ${narrationAudio.duration.toFixed(2)} seconds inside a ${fittedDuration}-second clip. The supplied waveform is authoritative: start the matching visible mouth shape on every Khmer phoneme and stop precisely on the last phoneme. ZERO-LATENCY LIP SYNC: each mouth shape must open or close on the exact same frame as its matching phoneme's sound, never one or more frames after it. A mouth that is still closed, still opening, or still mid-transition after its phoneme is already audible is a failure. Do not let the lips lag, trail, drift behind, catch up to, or echo the audio at any point in the clip -- re-anchor to the waveform every phoneme rather than letting a small delay accumulate over the clip. Speech, lips, jaw, tongue and cheeks remain synchronized frame by frame at natural 1x. Do not use generic talking-mouth animation. Keep the lips closed before the first phoneme. HARD MOUTH STOP: by ${narrationAudio.duration.toFixed(2)} seconds the speaker finishes the final phoneme, closes their mouth, and stays silent for the rest of the clip. Keep the head mostly forward and stable. Body and hand reactions use crisp fast-natural 1.1x energy without motion blur. Complete each gesture in 0.35 to 0.55 seconds. After speech, continue natural task actions at a normal pace until the full clip ends. Never freeze, stretch, ease or slow any movement.`,
    duration: fittedDuration,
    aspectRatio,
    referenceUrls: [avatarReferenceUrl],
    audioReferenceUrls: [narrationAudio.mediaUrl],
    generateAudio,
  };
  let job;
  let imageFallbackReason = '';
  try {
    job = await startOpenRouterVideo(videoRequest);
  } catch (error) {
    const imagePrivacyRejection = error?.statusCode === 400
      && /InputImageSensitiveContentDetected/i.test(`${error?.providerCode || ''} ${error?.message || ''}`);
    if (!imagePrivacyRejection) throw error;
    if (images.length) {
      throw Object.assign(new Error('The video provider rejected the uploaded starting image because it may show an identifiable person. Remove or replace that image, then generate again.'), { statusCode: 400 });
    }
    // A 400 rejection has no video job ID. For the automatically generated
    // presenter only, retry once with the same narration but no image input.
    // Keep a single accepted paid job and never retry a failed poll/completion.
    imageFallbackReason = 'The video provider rejected the generated presenter image. The clip was created from the scene and narration without a starting image.';
    const textOnlyPrompt = videoRequest.prompt.replace(/from the reference image/gi, 'described in the scene');
    job = await startOpenRouterVideo({
      ...videoRequest,
      prompt: `${textOnlyPrompt}\nNo reference image is supplied. Create the presenter from this scene description and synchronize the mouth to the supplied Khmer audio.`,
      referenceUrls: [],
    });
  }
  return {
    job: { ...job, outputDuration: fittedDuration },
    avatarImage,
    imageFallbackReason,
    narrationAudio: {
      ...narrationAudio,
      provider: audio.provider || audio.model || 'unknown',
      fallbackReason: audio.fallbackReason || '',
      spokenText: audio.spokenText || spokenScript,
    },
  };
};
