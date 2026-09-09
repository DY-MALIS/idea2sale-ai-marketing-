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
  return { script, mode: 'gemini', prompt: `${extractVideoDialogue(prompt).visual}\nVisual footage only. No speech or mouth movements simulating speech. A separate Gemini narration track will be added.` };
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
