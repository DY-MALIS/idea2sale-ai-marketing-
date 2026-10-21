type VideoSpeech = {
  script: string;
  voiceGender: string;
  businessName?: string;
  performanceStyle?: string;
  allowScriptShortening?: boolean;
};

type ResumeOptions = {
  silentRequested?: boolean;
  resumeNarration?: {
    text: string;
    voice: string;
    languageHint: 'Khmer' | 'English';
    performanceStyle: string;
    audioUrl?: string;
    duration?: number;
  };
};

// A saved job can only be reused when both the paid provider request and the
// browser's final audio choices match. Hash complete images as well: two images
// with identical ends and length can have different content in the middle.
export const videoRequestFingerprint = (
  prompt: string,
  images: { base64: string; mimeType: string }[],
  duration: number,
  aspectRatio: string,
  khmerSpeech?: VideoSpeech,
  resumeOptions?: ResumeOptions,
  productImageUrl?: string,
) => {
  const source = JSON.stringify({
    prompt, images, duration, aspectRatio, khmerSpeech,
    silentRequested: resumeOptions?.silentRequested,
    // The hosted audio URL changes on a safe retry. Identify the user's
    // narration choice, not the particular upload of that same speech.
    resumeNarration: resumeOptions?.resumeNarration && {
      text: resumeOptions.resumeNarration.text,
      voice: resumeOptions.resumeNarration.voice,
      languageHint: resumeOptions.resumeNarration.languageHint,
      performanceStyle: resumeOptions.resumeNarration.performanceStyle,
    },
    productImageUrl,
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};
