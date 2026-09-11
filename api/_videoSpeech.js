import { createKhmerNarration } from './_khmerNarration.js';
import { transcribeAudioWithOpenRouter } from './_openrouter.js';
import { compareKhmerTranscript, extractVideoDialogue, nativeSpeechPrompt, splitKhmerScript, visualOnlyVideoPrompt, wantsSilentVideo } from '../shared/videoSpeech.js';

export async function preparePlanVideoSpeech(item) {
  const prompt = String(item.prompt || '');
  if (item.voiceOverWanted === false || wantsSilentVideo(prompt)) return { prompt: nativeSpeechPrompt(prompt, ''), script: '', mode: 'silent' };
  // Calendar imports may embed exact dialogue in older English visual prompts.
  const embedded = extractVideoDialogue(prompt).script;
  const script = String(item.voiceOverText || embedded || await createKhmerNarration(prompt, 8, item.businessName)).trim();
  if (!/[\u1780-\u17ff]/u.test(script)) throw new Error('Khmer dialogue is required for this plan video.');
  splitKhmerScript(script, [8]);
  const performanceStyle = String(item.performanceStyle || 'Warm and trustworthy. Begin with curious energy, explain with calm confidence, emphasize the key benefit, and finish with an encouraging settled tone. Use natural Khmer rhythm, short phrase-boundary pauses, varied pitch and no theatrical exaggeration.');
  const visual = visualOnlyVideoPrompt(prompt);
  const presenter = item.voiceGender === 'Male' ? 'young adult Cambodian man, age 18 to 25' : 'young adult Cambodian woman, age 18 to 25';
  return {
    script,
    mode: 'edge-seedance',
    performanceStyle,
    prompt: `${visual}\nCASTING OVERRIDE: The same ${presenter} in the reference image performs the supplied audio; never age the presenter above 25. They look polished and work-ready in clean, tasteful modern company-office clothing. The supplied audio waveform is the only authority for phonemes and timing: derive every lip, jaw and tongue movement from it. Do not invent, translate, paraphrase or silently articulate any English words.`,
    avatarPrompt: `${visual}\nCASTING OVERRIDE: Create one primary photorealistic ${presenter}; do not depict anyone younger than 18 or older than 25. The primary presenter faces the camera with a friendly, confident, professional appearance and wears clean, tasteful modern company-office attire: a neat collared shirt or modest blouse with a fitted blazer, well groomed, no partywear and no revealing clothing. Match the number of people to the real activity: a solo task may show only the presenter, while a meeting, customer service or teamwork scene may include contextually relevant supporting Cambodian coworkers or customers, all age 18 to 25, naturally positioned and doing the real task. Supporting people remain secondary, silent, and slightly out of focus with mouths at rest so the primary speaker stays unambiguous. Relaxed upright pose, stable eye-level medium shot, primary face, chest and both hands visible, primary mouth gently closed, even flattering light, authentic Cambodian workplace. No text, captions, logos or exaggerated poses.`,
    motionPrompt: `Clear, confident and lively presenter delivery during a believable real-world activity. ${performanceStyle} Show one continuous action relevant to the topic, such as using a laptop, reviewing work, demonstrating a product, serving a customer or participating in a small meeting, instead of merely standing and posing. The scene may stay solo or include supporting people when the activity naturally requires them. Only the primary presenter speaks; all supporting people stay silent, do not lip-sync, and continue subtle natural background activity. Use expressive but professional facial reactions and two small purposeful hand or task gestures tied to the meaning of the two spoken clauses, with relaxed movement between phrases and natural blinking. TIMING OVERRIDE: Use energetic real-time conversational movement. Begin each gesture or task action with its related spoken phrase and settle promptly when that phrase ends. Follow the supplied audio without lengthening pauses or stretching syllables. Maintain clear visual focus on the speaker and finish with a warm confident expression. No repeated waving, random pointing, oversized gestures, dancing, theatrical acting, chaotic crowd movement or slow motion.`,
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
  let transcript;
  try {
    transcript = await transcribeAudioWithOpenRouter({ audioBase64: bytes.toString('base64'), format: 'wav', languageHint: 'Khmer' });
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
