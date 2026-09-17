import { createKhmerNarration } from './_khmerNarration.js';
import { normalizeForKhmerSpeech, transcribeAudioWithOpenRouter } from './_openrouter.js';
import { compareKhmerTranscript, extractVideoDialogue, nativeSpeechPrompt, splitKhmerScript, visualOnlyVideoPrompt, wantsSilentVideo } from '../shared/videoSpeech.js';
import { applyImageKitAudioExtractionTransform, isImageKitMediaUrl } from './_imagekitUpload.js';

const wait = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));

const verificationUnavailableError = ({ expected, cause, method, response }) => {
  const providerError = String(response?.headers?.get?.('ik-error') || '').slice(0, 500);
  const error = new Error('Automatic Khmer speech verification is temporarily unavailable. Video retained for manual review; not sent to Telegram.');
  error.verificationUnavailable = true;
  error.cause = cause;
  error.speechVerification = {
    passed: false,
    unavailable: true,
    expected,
    method,
    naturalnessReviewed: false,
    ...(Number(response?.status) > 0 ? { httpStatus: Number(response.status) } : {}),
    ...(providerError ? { providerError } : {}),
  };
  return error;
};

export async function preparePlanVideoSpeech(item) {
  const prompt = String(item.prompt || '');
  const requestedDuration = Number(item.duration);
  const duration = [4, 6, 8].includes(requestedDuration) ? requestedDuration : 8;
  if (item.voiceOverWanted === false || wantsSilentVideo(prompt)) return { prompt: nativeSpeechPrompt(prompt, ''), script: '', mode: 'silent' };
  // Calendar imports may embed exact dialogue in older English visual prompts.
  const embedded = extractVideoDialogue(prompt).script;
  const script = normalizeForKhmerSpeech(String(
    item.voiceOverText || embedded || await createKhmerNarration(prompt, duration, item.businessName),
  ));
  if (!/[\u1780-\u17ff]/u.test(script)) throw new Error('Khmer dialogue is required for this plan video.');
  splitKhmerScript(script, [duration]);
  const performanceStyle = String(item.performanceStyle || 'Warm and trustworthy. Speak in a natural Cambodian conversational voice at an everyday social-video pace. Fully pronounce every Khmer consonant, vowel, syllable and word ending; keep neighboring words distinct. Use at most one brief clause-boundary pause, vary pitch naturally, and finish cleanly without an announcer tone or theatrical exaggeration.');
  const visual = visualOnlyVideoPrompt(prompt);
  const presenter = item.voiceGender === 'Male' ? 'young adult Cambodian man, age 18 to 25' : 'young adult Cambodian woman, age 18 to 25';
  return {
    script,
    mode: 'edge-seedance',
    performanceStyle,
    prompt: `${visual}\nREAL-TIME SPEAKING SHOT AT NORMAL 1X SPEED, NEVER SLOW MOTION. Use the same ${presenter} from the reference image in an eye-level medium close-up. One primary speaker only; supporting people remain silent. Keep face, mouth and hands clear. The supplied audio controls exact lip timing. Locked camera and documentary-real human movement.`,
    avatarPrompt: `${visual}\nSPEAKING-SHOT OVERRIDE: Create one clearly dominant photorealistic primary ${presenter}. Add supporting Cambodian coworkers or customers only when they make the requested meeting, teamwork, service or product-demonstration context more believable. Everyone is age 18 to 25 and wears clean, tasteful modern company-office clothing. The primary presenter looks friendly, confident and work-ready, with straight-on eye contact and relaxed upright posture in a stable eye-level medium close-up from mid-torso upward. The primary face occupies at least one third of the frame height; lips, jawline and eyes are sharp and evenly lit. Keep the primary speaker's hands naturally below the shoulders and away from the face, with their mouth gently closed in the starting frame. Supporting people stay behind or beside the presenter, remain secondary and slightly out of focus, and keep their mouths at rest. Authentic uncluttered Cambodian workplace background. No text, captions, logos or exaggerated pose.`,
    motionPrompt: `TOP PRIORITY: FAST NATURAL HUMAN CREATOR ENERGY. Mouth and jaw stay exactly synchronized to the supplied audio at 1x, while body, hands and facial reactions move at 1.25x normal speed. Keep subtle breathing, natural blinking, small eye-focus changes and responsive expressions active. Perform two compact meaning-based hand or task gestures; each starts and finishes in 0.2 to 0.35 seconds, then the hands relax immediately. No pose freezes longer than 0.2 seconds. Never stretch one gesture across a phrase or let any hand movement last a full second. Locked camera. Absolutely no slow motion, slow camera, cinematic easing, repeated nodding, waving, random pointing, exaggerated acting or AI-avatar stillness.`,
  };
}

export async function verifyUploadedVideoSpeech(videoUrl, expected, { waitForRetry = wait } = {}) {
  if (!expected) throw new Error('Missing reference dialogue. Review this video before sending.');
  if (!isImageKitMediaUrl(videoUrl)) throw new Error('Invalid uploaded video URL.');
  const audioUrl = applyImageKitAudioExtractionTransform(videoUrl);
  let audio;
  let fetchCause;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // ImageKit can return a redirect while a first-time video transform is
      // still processing. Inspect that response instead of following it to the
      // original MP4 and accidentally treating the full video as extracted audio.
      audio = await fetch(audioUrl, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
      if (audio.ok) break;
    } catch (cause) {
      fetchCause = cause;
    }
    if (attempt < 4) await waitForRetry(1000 * (2 ** attempt));
  }
  if (!audio?.ok) {
    throw verificationUnavailableError({
      expected,
      cause: fetchCause || new Error(`ImageKit audio extraction returned HTTP ${audio?.status || 'unknown'}.`),
      method: 'audio-extraction-unavailable',
      response: audio,
    });
  }
  let bytes;
  try {
    bytes = Buffer.from(await audio.arrayBuffer());
  } catch (cause) {
    throw verificationUnavailableError({ expected, cause, method: 'audio-download-unavailable', response: audio });
  }
  if (!bytes.length || bytes.length > 6000000) {
    throw verificationUnavailableError({
      expected,
      cause: new Error('Invalid verification audio size.'),
      method: 'audio-extraction-invalid',
      response: audio,
    });
  }
  let transcript;
  try {
    transcript = await transcribeAudioWithOpenRouter({ audioBase64: bytes.toString('base64'), format: 'mp4', languageHint: 'Khmer' });
  } catch (cause) {
    // The generated video is still a valid, paid-for artifact when the separate
    // STT provider is unavailable. Distinguish that infrastructure failure from
    // an actual transcript mismatch so the delivery worker can retain the video
    // for human review instead of presenting generation itself as FAILED (and
    // encouraging a second paid generation attempt).
    throw verificationUnavailableError({ expected, cause, method: 'transcription-unavailable' });
  }
  const check = compareKhmerTranscript(expected, transcript);
  const verification = { ...check, transcript, expected, method: 'transcript-comparison', naturalnessReviewed: false };
  if (!check.passed) {
    const error = new Error('Khmer speech could not be verified against the script. Video retained for review; not sent to Telegram.');
    error.speechVerification = verification;
    throw error;
  }
  return verification;
}
