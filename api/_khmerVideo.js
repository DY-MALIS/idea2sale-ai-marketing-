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
import { assertVideoCreditAvailable } from './_videoCredit.js';

const MIN_KHMER_CLIP_DURATION = 4;
const MAX_KHMER_CLIP_DURATION = 8;
const VIDEO_START_DEADLINE_MS = 275_000;
const VIDEO_SUBMISSION_RESERVE_MS = 90_000;
const VIDEO_PREPARATION_MAX_MS = 180_000;

const preparationTimeoutError = () => Object.assign(
  new Error('Preparing the Khmer voice and presenter took too long. No video job was started; please try again.'),
  { videoStartNotSubmitted: true, statusCode: 503 },
);

const finishPreparationBefore = async (preparation, timeoutMs) => {
  if (timeoutMs < 1_000) throw preparationTimeoutError();
  let timer;
  try {
    return await Promise.race([
      preparation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(preparationTimeoutError()), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
// Generated lettering is not a reliable way to render Khmer. This path is
// shared by scheduled and interactive clips and bypasses ai.js's visual prompt.
const visualPrompt = (prompt = '') => `${prompt}\nVISUAL TEXT RULE: Do not generate readable text, invented letters, subtitles or captions anywhere. Show computer and phone screens as clean icon-based interfaces, charts and colored blocks without text; show documents, labels and signs as blank surfaces. Never paint the spoken transcript into the scene. Preserve an existing supplied logo without inventing or changing its lettering. Exact text must be added separately with a real font renderer.\nPHOTOREALISM: Film this like a real camera shot on location -- never an illustration, cartoon, 3D render, or plastic/synthetic-looking AI image. Use natural realistic lighting, true-to-life shadows and authentic material texture. Keep the entire frame in crisp, high-detail sharp focus -- no blur, haze, softness, or low-resolution artifacts anywhere. Render every subject, object and action named above exactly as described; the background and any visible props must genuinely belong to that scene and relate naturally to it -- never a generic, empty, or mismatched backdrop.`;

const textOnlyPresenterRequest = ({ speech, duration, aspectRatio }) => ({
  model: KHMER_VIDEO_MODEL,
  khmerSpeech: true,
  prompt: `${visualPrompt(speech.prompt).replace(/from the reference image/gi, 'described in the scene')}\n${speech.motionPrompt || ''}\nNo reference image or audio is supplied. This is a Khmer voiceover scene, not an on-camera speaking shot. Show the product, hands, work, or an over-the-shoulder view with the speaker's mouth out of frame. Do not show visible lips, a talking face, or mouth movement anywhere in the clip. The final Khmer narration will be added after rendering; do not invent audible speech or captions.`,
  duration,
  aspectRatio,
  referenceUrls: [],
  audioReferenceUrls: [],
  generateAudio: false,
});

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
  allowImageFallback = false,
  // An ImageKit URL of a real product photo (from the business's saved
  // profile gallery) the presenter should hold/showcase alongside their own
  // identity -- see the PRODUCT REFERENCE block built below.
  productImageUrl = '',
  deadlineAt = Date.now() + VIDEO_START_DEADLINE_MS,
  onVideoSubmissionStart,
  creditChecked = false,
} = {}) => {
  const preparationStartedAt = Date.now();
  const hasKhmerSpeech = speech.mode !== 'silent';
  assertVideoGenerationWithinBudget({
    duration,
    khmerSpeech: hasKhmerSpeech,
    model: hasKhmerSpeech ? KHMER_VIDEO_MODEL : STANDARD_VIDEO_MODEL,
  });
  if (!creditChecked) await assertVideoCreditAvailable();
  if (speech.mode === 'silent') {
    const timeoutMs = deadlineAt - Date.now() - 5_000;
    if (timeoutMs < 15_000) throw preparationTimeoutError();
    onVideoSubmissionStart?.();
    return { job: await startOpenRouterVideo({ prompt: visualPrompt(speech.prompt), duration, aspectRatio, timeoutMs }), avatarImage: null };
  }
  // Only this preparation promise may outlive its deadline. The paid video
  // submission sits after the race, so a late TTS or image response cannot
  // create a job after the server has reported a safe pre-submission failure.
  const prepare = async () => {
  // Start the avatar image now, in parallel with the narration pipeline below
  // -- it only depends on speech.avatarPrompt/aspectRatio/images, none of
  // which involve narration audio at all, so there's no reason the (often
  // slow, sometimes multi-step: TTS, duration-fit retries, expand/shorten
  // rewrites) narration work below should block it from starting. Awaited
  // just before it's actually needed, right after the narration pipeline
  // finishes and fittedDuration is known.
  const imagePromise = (images.length
    ? Promise.resolve({ imageUrl: `data:${images[0].mimeType};base64,${images[0].base64}` })
    : generateOpenRouterImage({ prompt: visualPrompt(speech.avatarPrompt), aspectRatio, model: BUDGET_AVATAR_IMAGE_MODEL, timeoutMs: 55_000 }))
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
  if ('error' in imageResult) {
    if (!allowImageFallback || images.length) throw imageResult.error;
    return {
      videoRequest: textOnlyPresenterRequest({ speech, duration: fittedDuration, aspectRatio }),
      avatarImage: null, narrationAudio, audio, fittedDuration,
      avatarReferenceUrl: '', normalizedProductImageUrl: '', productReferenceBlock: '', spokenScript,
      imageFallbackReason: 'The presenter image could not be generated. The video was created from the scene and the original Khmer narration was added afterward. Review the speaker and lip sync before publishing.',
    };
  }
  const image = imageResult.image;
  let avatarImage;
  try {
    avatarImage = await uploadMediaDataUrl({ mediaDataUrl: image.imageUrl, mediaType: 'photo' });
  } catch (error) {
    if (!allowImageFallback || images.length) throw error;
    return {
      videoRequest: textOnlyPresenterRequest({ speech, duration: fittedDuration, aspectRatio }),
      avatarImage: null, narrationAudio, audio, fittedDuration,
      avatarReferenceUrl: '', normalizedProductImageUrl: '', productReferenceBlock: '', spokenScript,
      imageFallbackReason: 'The presenter image could not be uploaded. The video was created from the scene and the original Khmer narration was added afterward. Review the speaker and lip sync before publishing.',
    };
  }
  const avatarReferenceUrl = getOriginalImageKitUrl(avatarImage.mediaUrl, process.env.IMAGEKIT_URL_ENDPOINT || '');
  // startOpenRouterVideo silently drops any referenceUrls entry that isn't an
  // https:// URL (api/_openrouter.js), and a Khmer presenter request always
  // carries audioReferenceUrls -- so an unusable avatar reference doesn't
  // surface as "avatar upload failed" but as the paid provider rejecting the
  // resulting audio-only request ("reference_audio cannot be the only
  // reference input"), after the narration cost (and sometimes a real video
  // submission attempt) has already been spent. Fail loudly here instead,
  // before any of that money is at risk.
  if (!/^https:\/\//.test(avatarReferenceUrl)) {
    if (allowImageFallback && !images.length) {
      return {
        videoRequest: textOnlyPresenterRequest({ speech, duration: fittedDuration, aspectRatio }),
        avatarImage: null, narrationAudio, audio, fittedDuration,
        avatarReferenceUrl: '', normalizedProductImageUrl: '', productReferenceBlock: '', spokenScript,
        imageFallbackReason: 'The presenter image upload returned no usable URL. The video was created from the scene and the original Khmer narration was added afterward. Review the speaker and lip sync before publishing.',
      };
    }
    throw new Error('Could not prepare the presenter image for this video (upload returned no usable URL). Please try generating again.');
  }
  const normalizedProductImageUrl = productImageUrl
    ? getOriginalImageKitUrl(productImageUrl, process.env.IMAGEKIT_URL_ENDPOINT || '')
    : '';
  // Image generation (generateOpenRouterImage above) is text-to-image only --
  // there is no way to pre-compose "presenter holding this exact product"
  // into one avatar image. Instead, send the product photo as a second
  // reference image straight to the video model and describe both in the
  // prompt; the video model already supports more than one input_references
  // entry (see startOpenRouterVideo's Seedance branch).
  const productReferenceBlock = normalizedProductImageUrl
    ? ` PRODUCT REFERENCE: Reference image 1 shows the presenter's exact identity -- face, body and clothing must match it precisely. Reference image 2 shows a real product photo: reproduce this exact product's packaging, label text, logo, color and shape unchanged and legible, held naturally in the presenter's hand or set on a nearby surface as part of a natural showcase gesture. Work it into the existing hand gestures -- lift it into view, turn it to show the label, or gesture toward it at least once during the narration. Never invent a different product or redesign its packaging. The background and setting must suit this specific product naturally (a fitting clean surface or environment for it, e.g. a vanity/counter for skincare or a cafe table for a drink) rather than a generic or unrelated backdrop.`
    : '';
  const exactKhmerTranscript = String(narrationAudio.spokenText || spokenScript || '').trim();
  const videoRequest = {
    // Mini retains image/audio reference support while keeping an 8-second
    // Khmer presenter video (including avatar + narration reserve) under $0.80.
    model: KHMER_VIDEO_MODEL,
    khmerSpeech: true,
    prompt: `${visualPrompt(speech.prompt)}\n${speech.motionPrompt}${productReferenceBlock}\nLANGUAGE LOCK: The English wording in these production directions describes visuals only. Never infer, invent, speak, or visibly articulate any English word. The only speech and mouth movement is Cambodian Khmer from the supplied audio waveform. KHMER PHONEME TRANSCRIPT (exact, never translate or paraphrase): ${JSON.stringify(exactKhmerTranscript)}. AUDIO MASTER CLOCK: ${narrationAudio.duration.toFixed(2)} seconds inside a ${fittedDuration}-second clip. The supplied waveform is authoritative: start the matching visible mouth shape on every Khmer phoneme and stop precisely on the last phoneme. ZERO-LATENCY LIP SYNC: each mouth shape must open or close on the exact same frame as its matching phoneme's sound, never one or more frames after it. A mouth that is still closed, still opening, or still mid-transition after its phoneme is already audible is a failure. Do not let the lips lag, trail, drift behind, catch up to, or echo the audio at any point in the clip -- re-anchor to the waveform every phoneme rather than letting a small delay accumulate over the clip. Speech, lips, jaw, tongue and cheeks remain synchronized frame by frame at natural 1x. Do not use generic talking-mouth animation. Keep the lips closed before the first phoneme. HARD MOUTH STOP: by ${narrationAudio.duration.toFixed(2)} seconds the speaker finishes the final phoneme, closes their mouth, and stays silent for the rest of the clip. Keep the head mostly forward and stable. Body and hand reactions move continuously at crisp natural real-world energy without motion blur, flowing from one gesture into the next with no held pose or freeze. After speech, keep moving with natural task action at a normal pace until the full clip ends. Never freeze, stretch, ease or slow any movement.`,
    duration: fittedDuration,
    aspectRatio,
    referenceUrls: normalizedProductImageUrl ? [avatarReferenceUrl, normalizedProductImageUrl] : [avatarReferenceUrl],
    audioReferenceUrls: [narrationAudio.mediaUrl],
    generateAudio,
  };
  return { videoRequest, avatarImage, narrationAudio, audio, fittedDuration, avatarReferenceUrl, normalizedProductImageUrl, productReferenceBlock, spokenScript };
  };
  let prepared;
  try {
    const remainingMs = deadlineAt - Date.now() - VIDEO_SUBMISSION_RESERVE_MS;
    if (remainingMs < 1_000) throw preparationTimeoutError();
    prepared = await finishPreparationBefore(prepare(), Math.min(VIDEO_PREPARATION_MAX_MS, remainingMs));
  } catch (error) {
    if (error && typeof error === 'object') error.videoStartNotSubmitted = true;
    throw error;
  }
  const { videoRequest, avatarImage, narrationAudio, audio, fittedDuration, avatarReferenceUrl, normalizedProductImageUrl, productReferenceBlock, spokenScript } = prepared;
  const submitVideo = (request) => {
    const timeoutMs = Math.min(VIDEO_SUBMISSION_RESERVE_MS, deadlineAt - Date.now() - 5_000);
    if (timeoutMs < 15_000) throw preparationTimeoutError();
    onVideoSubmissionStart?.();
    return startOpenRouterVideo({ ...request, timeoutMs });
  };
  let job;
  let imageFallbackReason = prepared.imageFallbackReason || '';
  try {
    job = await submitVideo(videoRequest);
  } catch (error) {
    const imagePrivacyRejection = error?.statusCode === 400
      && /InputImageSensitiveContentDetected/i.test(`${error?.providerCode || ''} ${error?.message || ''}`);
    if (!imagePrivacyRejection) throw error;

    // The product photo is the "extra" input on top of an otherwise-working
    // presenter flow -- drop it and retry once before falling through to the
    // existing presenter-image handling below. This also sidesteps needing to
    // parse provider error text for which reference index was flagged, which
    // isn't reliably available.
    if (normalizedProductImageUrl) {
      try {
        job = await submitVideo({
          ...videoRequest,
          prompt: videoRequest.prompt.replace(productReferenceBlock, ''),
          referenceUrls: [avatarReferenceUrl],
        });
        imageFallbackReason = 'The video provider rejected the selected product photo. The clip was created showing your presenter only, without that exact product.';
      } catch (retryError) {
        const stillRejected = retryError?.statusCode === 400
          && /InputImageSensitiveContentDetected/i.test(`${retryError?.providerCode || ''} ${retryError?.message || ''}`);
        if (!stillRejected) throw retryError;
        error = retryError;
      }
    }

    if (!job) {
      if (images.length) {
        // Seedance 2.x does not accept direct uploads of real human faces.
        // Veo's image-to-video path can use the user's original photo as the
        // actual first frame. Keep the supplied Khmer narration for browser
        // muxing, but do not claim lip sync from this alternate model.
        try {
          job = await submitVideo({
            model: STANDARD_VIDEO_MODEL,
            khmerSpeech: true,
            prompt: `${visualPrompt(speech.prompt)}\nAnimate the supplied first-frame photo as a natural short camera shot. Preserve its people, products, setting and composition. Do not create dialogue, speech, subtitles or conspicuous talking-mouth motion; the original Khmer narration is added after rendering.`,
            images: images.slice(0, 1),
            duration: fittedDuration,
            aspectRatio,
            generateAudio: false,
          });
          imageFallbackReason = 'Seedance rejected the uploaded photo, so the original image was animated with Veo and the Khmer narration was added afterward. Review the result and lip sync before publishing.';
        } catch (alternateError) {
          if (alternateError?.statusCode === 400
            && /InputImageSensitiveContentDetected/i.test(`${alternateError?.providerCode || ''} ${alternateError?.message || ''}`)) {
            throw Object.assign(new Error('Both video providers rejected the uploaded starting image because it may show an identifiable person. Use a product or scene photo without visible faces.'), { statusCode: 400 });
          }
          throw alternateError;
        }
      }
      if (!job && !allowImageFallback) {
        throw Object.assign(new Error('The video provider rejected the automatically generated presenter image. Change the scene or presenter description before creating this scheduled video.'), { statusCode: 400 });
      }
      if (!job) {
        // Seedance rejects an audio reference as the only reference input. Make
        // an actual text-to-video request instead; the browser will mux the
        // original Khmer narration after generation.
        imageFallbackReason = 'The video provider rejected the generated presenter image. The clip was created from the scene and the original Khmer narration was added afterward. Review lip sync before publishing.';
        job = await submitVideo(textOnlyPresenterRequest({ speech, duration: fittedDuration, aspectRatio }));
      }
    }
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
