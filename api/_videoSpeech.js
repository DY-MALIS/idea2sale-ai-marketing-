import { createKhmerNarration } from './_khmerNarration.js';
import { transcribeAudioWithOpenRouter } from './_openrouter.js';
import { compareKhmerTranscript, extractVideoDialogue, nativeSpeechPrompt, splitKhmerScript, wantsSilentVideo } from '../shared/videoSpeech.js';

export async function preparePlanVideoSpeech(item) {
  const prompt = String(item.prompt || '');
  if (item.voiceOverWanted === false || wantsSilentVideo(prompt)) return { prompt: nativeSpeechPrompt(prompt, ''), script: '', mode: 'silent' };
  // Calendar imports may embed exact dialogue in older English visual prompts.
  const embedded = extractVideoDialogue(prompt).script;
  const script = String(item.voiceOverText || embedded || await createKhmerNarration(prompt, 8)).trim();
  if (!/[\u1780-\u17ff]/u.test(script)) throw new Error('Khmer dialogue is required for this plan video.');
  splitKhmerScript(script, [8]);
  const performanceStyle = String(item.performanceStyle || 'Warm and trustworthy. Begin with curious energy, explain with calm confidence, emphasize the key benefit, and finish with an encouraging settled tone. Use natural Khmer rhythm, short phrase-boundary pauses, varied pitch and no theatrical exaggeration.');
  const visual = extractVideoDialogue(prompt).visual;
  const presenter = item.voiceGender === 'Male' ? 'adult Cambodian man' : 'adult Cambodian woman';
  return {
    script,
    mode: 'edge-seedance',
    performanceStyle,
    prompt: `${visual}\nThe same ${presenter} in the reference image speaks naturally to camera in Khmer. Match mouth movement precisely to the supplied audio.`,
    avatarPrompt: `${visual}\nCreate one photorealistic ${presenter} presenter facing the camera in a relaxed upright pose. Stable eye-level medium shot, face, chest and both hands visible, mouth gently closed, even flattering light, simple authentic Cambodian workplace background. No other people, text, captions, logos or exaggerated pose.`,
    motionPrompt: `Natural presenter delivery. ${performanceStyle} Use one restrained gesture tied to the key idea, relaxed hands between phrases, subtle blinking and facial reactions. No repeated waving, random pointing, oversized gestures or slow motion.`,
  };
}

export async function verifyUploadedVideoSpeech(videoUrl, expected) {
  if (!expected) throw new Error('Missing reference dialogue. Review this video before sending.');
  const url = new URL(videoUrl);
  if (url.hostname !== 'res.cloudinary.com' || url.protocol !== 'https:' || !url.pathname.includes('/video/upload/')) throw new Error('Invalid uploaded video URL.');
  url.pathname = url.pathname.replace('/video/upload/', '/video/upload/f_wav,af_16000/').replace(/\.[a-z0-9]+$/i, '.wav');
  const audio = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!audio.ok) throw new Error('Could not extract video audio for verification.');
  const bytes = Buffer.from(await audio.arrayBuffer());
  if (!bytes.length || bytes.length > 6000000) throw new Error('Invalid verification audio size.');
  const transcript = await transcribeAudioWithOpenRouter({ audioBase64: bytes.toString('base64'), format: 'wav', languageHint: 'Khmer' });
  const check = compareKhmerTranscript(expected, transcript);
  const verification = { ...check, transcript, expected, method: 'transcript-comparison', naturalnessReviewed: false };
  if (!check.passed) {
    const error = new Error('Khmer speech could not be verified against the script. Video retained for review; not sent to Telegram.');
    error.speechVerification = verification;
    throw error;
  }
  return verification;
}
