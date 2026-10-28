import { createKhmerNarration, isUnreliableKhmerTranscript } from './_khmerNarration.js';
import { normalizeForKhmerSpeech, transcribeAudioWithOpenRouter } from './_openrouter.js';
import { compareKhmerTranscript, extractVideoDialogue, isKhmerOnlyNarration, nativeSpeechPrompt, visualOnlyVideoPrompt, wantsSilentVideo } from '../shared/videoSpeech.js';
import { applyImageKitAudioExtractionTransform, isImageKitMediaUrl } from './_imagekitUpload.js';
import { isR2MediaUrl } from './_r2Storage.js';
import { extractR2Audio } from './_r2Audio.js';

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
  if (item.voiceOverWanted === false || (item.voiceOverWanted !== true && wantsSilentVideo(prompt))) {
    return { prompt: nativeSpeechPrompt(prompt, ''), script: '', mode: 'silent' };
  }
  // Calendar imports may embed exact dialogue in older English visual prompts.
  const embedded = extractVideoDialogue(prompt).script;
  const suppliedScript = String(item.voiceOverText || embedded || '').trim();
  let script = normalizeForKhmerSpeech(suppliedScript || await createKhmerNarration(prompt, duration, item.businessName));
  if (!isKhmerOnlyNarration(script) && suppliedScript
    && (item.allowScriptShortening === true || (item.allowScriptShortening === undefined && item.scriptEditedByUser !== true))) {
    // Scanner and calendar scripts are AI-authored. Repair an unknown Latin or
    // foreign word before submitting a paid video; preserve a user's edited line.
    script = normalizeForKhmerSpeech(await createKhmerNarration(
      `Video scene: ${prompt}. Intended spoken meaning: ${suppliedScript}`, duration, item.businessName,
    ));
  }
  if (!isKhmerOnlyNarration(script)) throw new Error('Khmer dialogue must use Khmer script only. Please edit the narration before generating the video.');
  // Do not reject a single short clip from Khmer code-point counts. Khmer
  // vowels and combining signs make visually short text look artificially long
  // to String.length, while startKhmerVideoJob measures the real synthesized
  // waveform and can safely expand a 4/6-second request up to the 8-second cost
  // ceiling. The measured audio duration is the authoritative fit check.
  const performanceStyle = String(item.performanceStyle || 'Warm and trustworthy. Speak in a natural Cambodian conversational voice at an everyday social-video pace. Fully pronounce every Khmer consonant, vowel, syllable and word ending; keep neighboring words distinct. Use at most one brief clause-boundary pause, vary pitch naturally, and finish cleanly without an announcer tone or theatrical exaggeration.');
  const visual = visualOnlyVideoPrompt(prompt);
  const presenter = item.voiceGender === 'Male' ? 'young adult Cambodian man, age 18 to 25' : 'young adult Cambodian woman, age 18 to 25';
  return {
    script,
    mode: 'edge-seedance',
    performanceStyle,
    prompt: `${visual}\nREAL-TIME 1X SPEAKING SHOT. Use the same ${presenter} from the reference image in an eye-level medium close-up. Only the primary presenter speaks; others stay silent. Head forward; face tack-sharp; lips, jaw and hands clear without motion blur. Supplied audio is the master clock for frame-by-frame lip timing. Locked camera, natural human motion, never slow motion.`,
    avatarPrompt: `${visual}\nSPEAKING-SHOT OVERRIDE: Create one clearly dominant photorealistic primary ${presenter}. When the scene suits it (a workplace, shop, meeting, or service moment), include two or three distinct supporting Cambodian coworkers or customers as real, clearly visible people with their own distinct look -- not a single blurred extra. Everyone is age 18 to 25 and wears clean, tasteful modern company-office clothing. The primary presenter has a warm, approachable expression with a slight genuine smile, confident straight-on eye contact and relaxed upright posture in a stable eye-level medium close-up from mid-torso upward. The primary face occupies at least one third of the frame height; lips, jawline, eyes and both hands are tack-sharp, high-detail and evenly lit, in crisp focus with no blur, haze or softness anywhere in the frame. Start with the hands visible, relaxed and separated near a relevant work prop, ready for a small task action; do not clasp, fold or hide them. Keep the mouth gently closed in the starting frame. Supporting people stay behind or beside the presenter, clearly visible in reasonable focus (never reduced to a vague blurred shape), and keep their mouths at rest -- only the primary presenter speaks. Authentic uncluttered Cambodian workplace background. No text, captions, logos or exaggerated pose.`,
    // Many earlier revisions of this prompt tuned the exact gesture count and
    // millisecond timing of discrete start-stop bursts (see git history) without
    // fixing reports of stiff, sparse, unattractive motion. A burst-then-freeze
    // structure is itself the likely cause -- real conversational body language
    // is continuous and overlapping, not isolated poses with rest in between.
    // This asks for continuous, varied, never-still motion instead of counting
    // gestures, and calls out full, visible mouth shapes explicitly.
    motionPrompt: `TOP PRIORITY: PRECISE AUDIO-DRIVEN HUMAN SPEECH. Match each mouth shape to its audio phoneme with a full, clear, natural mouth opening on every syllable -- never a small, stiff, barely-moving mouth; jaw, lips and cheeks stay synchronized frame by frame at natural 1x. CONTINUOUS LIVELY ENERGY: hands, arms and upper body keep moving naturally and fluidly for the entire clip at ordinary real-world speed, flowing from one gesture straight into the next with no pause, freeze or held pose -- the way a confident, animated creator actually talks on camera. Vary the gestures (open palms, a light point, a small count, leaning in) so none repeats. Keep natural breathing, blinking and eye-focus changes, and an engaged, expressive face throughout -- animated eyebrows, alert eyes, a genuine smile on positive beats, never a flat or mannequin-still stare. Locked camera; no slow motion or a robotic stop-start rhythm.`,
  };
}

export async function verifyUploadedVideoSpeech(videoUrl, expected, { waitForRetry = wait } = {}) {
  if (!expected) throw new Error('Missing reference dialogue. Review this video before sending.');
  if (!isImageKitMediaUrl(videoUrl)) throw new Error('Invalid uploaded video URL.');
  if (isR2MediaUrl(videoUrl)) {
    let bytes;
    try { bytes = await extractR2Audio(videoUrl); }
    catch (cause) { throw verificationUnavailableError({ expected, cause, method: 'r2-audio-extraction-unavailable' }); }
    return verifyExtractedSpeech(bytes, expected);
  }
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
  return verifyExtractedSpeech(bytes, expected);
}

async function verifyExtractedSpeech(bytes, expected) {
  if (!bytes.length || bytes.length > 6000000) throw verificationUnavailableError({ expected, method: 'audio-extraction-invalid' });
  // The narration audio itself is already the trusted Khmer TTS track (edge-seedance
  // videos mux the exact reference audio back in before this check ever runs); a
  // failed comparison here usually means the Chirp 3 STT model hallucinated the
  // transcript in the wrong script for this one attempt, not that the video is
  // actually wrong. Re-transcribing the same untouched audio bytes a couple more
  // times catches that transient failure instead of discarding a good video.
  const MAX_TRANSCRIPTION_ATTEMPTS = 3;
  let verification;
  let reliableMismatchCount = 0;
  for (let attempt = 1; attempt <= MAX_TRANSCRIPTION_ATTEMPTS; attempt += 1) {
    let transcript;
    try {
      transcript = await transcribeAudioWithOpenRouter({ audioBase64: bytes.toString('base64'), format: 'mp4', languageHint: 'Khmer', timeoutMs: 18_000 });
    } catch (cause) {
      if (attempt === MAX_TRANSCRIPTION_ATTEMPTS) {
        // The generated video is still a valid, paid-for artifact when the separate
        // STT provider is unavailable. Distinguish that infrastructure failure from
        // an actual transcript mismatch so the delivery worker can retain the video
        // for human review instead of presenting generation itself as FAILED (and
        // encouraging a second paid generation attempt).
        throw verificationUnavailableError({ expected, cause, method: 'transcription-unavailable' });
      }
      continue;
    }
    if (isUnreliableKhmerTranscript(transcript) || !/[\u1780-\u17ff]/u.test(transcript)) continue;
    const check = compareKhmerTranscript(expected, transcript);
    verification = { ...check, transcript, expected, method: 'transcript-comparison', naturalnessReviewed: false };
    if (check.passed) return verification;
    reliableMismatchCount += 1;
  }
  if (reliableMismatchCount < 2) {
    throw verificationUnavailableError({ expected, method: 'transcription-inconclusive' });
  }
  const error = new Error('Khmer speech could not be verified against the script. Video retained for review; not sent to Telegram.');
  error.speechVerification = verification;
  throw error;
}
