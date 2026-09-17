import { createKhmerNarration } from './_khmerNarration.js';
import { normalizeForKhmerSpeech, transcribeAudioWithOpenRouter } from './_openrouter.js';
import { compareKhmerTranscript, extractVideoDialogue, nativeSpeechPrompt, splitKhmerScript, visualOnlyVideoPrompt, wantsSilentVideo } from '../shared/videoSpeech.js';
import { applyImageKitAudioExtractionTransform, isImageKitMediaUrl } from './_imagekitUpload.js';

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
  const performanceStyle = String(item.performanceStyle || 'Warm and trustworthy. Speak in a lively natural Cambodian conversational voice at an everyday social-video pace, about ten percent faster than a careful presenter read. Keep every Khmer syllable crisp, use at most one very brief phrase-boundary pause, vary pitch naturally, and finish cleanly without an announcer tone or theatrical exaggeration.');
  const visual = visualOnlyVideoPrompt(prompt);
  const presenter = item.voiceGender === 'Male' ? 'young adult Cambodian man, age 18 to 25' : 'young adult Cambodian woman, age 18 to 25';
  return {
    script,
    mode: 'edge-seedance',
    performanceStyle,
    prompt: `${visual}\nSPEAKING-SHOT OVERRIDE: The same ${presenter} in the reference image is the primary speaker and performs the supplied audio; never age the presenter above 25. Include supporting Cambodian coworkers or customers when the requested activity naturally needs them, but they remain visually secondary, silent and never articulate words. Keep the primary speaker in a straight-on, eye-level, stable medium close-up from mid-torso upward, with their face large, sharp and evenly lit for the entire clip. The supplied audio waveform is the only authority for phonemes and timing: derive every lip, jaw and facial movement from it. Keep the speaker's head nearly frontal, maintain eye contact, and never hide their mouth with a hand, product, hair, shadow or camera motion. Do not invent, translate, paraphrase or silently articulate any other words.`,
    avatarPrompt: `${visual}\nSPEAKING-SHOT OVERRIDE: Create one clearly dominant photorealistic primary ${presenter}. Add supporting Cambodian coworkers or customers only when they make the requested meeting, teamwork, service or product-demonstration context more believable. Everyone is age 18 to 25 and wears clean, tasteful modern company-office clothing. The primary presenter looks friendly, confident and work-ready, with straight-on eye contact and relaxed upright posture in a stable eye-level medium close-up from mid-torso upward. The primary face occupies at least one third of the frame height; lips, jawline and eyes are sharp and evenly lit. Keep the primary speaker's hands naturally below the shoulders and away from the face, with their mouth gently closed in the starting frame. Supporting people stay behind or beside the presenter, remain secondary and slightly out of focus, and keep their mouths at rest. Authentic uncluttered Cambodian workplace background. No text, captions, logos or exaggerated pose.`,
    motionPrompt: `LIP-SYNC AND REAL-TIME HUMAN MOTION HAVE HIGHEST PRIORITY. ${performanceStyle} Keep exactly one audible primary speaker in a continuous locked stable-camera shot; supporting people may perform subtle context-appropriate activity but remain silent and never lip-sync. The primary face stays nearly frontal and fully visible; limit head turns to a few degrees and keep hands and objects below the chin. Match each lip closure, jaw opening and facial motion directly to the supplied audio with no delayed mouth start, extra mouthing or continued speech after the audio ends. Never hold a perfectly still AI-avatar pose: maintain continuous subtle breathing, natural blinks, tiny eye focus changes, small facial reactions and relaxed weight shifts between phrases. Use two crisp, purposeful hand or task gestures tied to the two spoken clauses. Each gesture begins immediately with its phrase, completes in 0.4 to 0.7 seconds, and returns directly to a relaxed position without lingering or cinematic easing. Maintain lively confident real-world energy throughout; no visible pose may freeze for longer than half a second, and never stretch one movement across multiple seconds. Supporting actions also move at normal real-life speed. No camera push, slow camera movement, slow motion, long pose, repeated waving, nodding loop, random pointing, oversized gesture, dancing, theatrical acting or distracting background motion.`,
  };
}

export async function verifyUploadedVideoSpeech(videoUrl, expected) {
  if (!expected) throw new Error('Missing reference dialogue. Review this video before sending.');
  if (!isImageKitMediaUrl(videoUrl)) throw new Error('Invalid uploaded video URL.');
  const audioUrl = applyImageKitAudioExtractionTransform(videoUrl);
  const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) });
  if (!audio.ok) throw new Error('Could not extract video audio for verification.');
  const bytes = Buffer.from(await audio.arrayBuffer());
  if (!bytes.length || bytes.length > 6000000) throw new Error('Invalid verification audio size.');
  let transcript;
  try {
    transcript = await transcribeAudioWithOpenRouter({ audioBase64: bytes.toString('base64'), format: 'mp4', languageHint: 'Khmer' });
  } catch (cause) {
    // The generated video is still a valid, paid-for artifact when the separate
    // STT provider is unavailable. Distinguish that infrastructure failure from
    // an actual transcript mismatch so the delivery worker can retain the video
    // for human review instead of presenting generation itself as FAILED (and
    // encouraging a second paid generation attempt).
    const error = new Error('Automatic Khmer speech verification is temporarily unavailable. Video retained for manual review; not sent to Telegram.');
    error.verificationUnavailable = true;
    error.cause = cause;
    error.speechVerification = {
      passed: false,
      unavailable: true,
      expected,
      method: 'transcription-unavailable',
      naturalnessReviewed: false,
    };
    throw error;
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
