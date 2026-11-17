const creationVerb = /\b(?:create|make|generate|produce|draft|build|prepare|design|write|draw)\b|បង្កើត|ធ្វើ|រៀបចំ|សរសេរ|ផលិត|សូមបង្កើត|ចង់បាន|គូរ|ជួយ/iu;
const adviceQuestion = /^(?:how|why|what|which|should|can you explain|របៀប|ហេតុអ្វី|យ៉ាងដូចម្តេច|តើ.+(?:អ្វី|យ៉ាងណា))/iu;
// Includes how Khmer speech-to-text writes the spoken loanwords
// ("ខនថេនផ្លែន" for "content plan", "ប៉ុស្ត៍" for "post").
const planNoun = /\b(?:content\s*plan(?:ner)?|content\s*calendar|posting\s*(?:calendar|plan|schedule)|plan\s+for\s+content|\d{1,2}[- ]?days?\s+(?:content\s+|post(?:ing)?\s+)?plan|weekly\s+(?:content\s+|post(?:ing)?\s+)?plan)\b|ផែនការ\s*(?:មាតិកា|ខ្លឹមសារ|បង្ហោះ|content|ប៉ុស្ត៍|ប៉ុស្តិ៍|ប៉ុស|ផុស|ប្រកាស|ផ្សព្វផ្សាយ|[០-៩0-9]{1,2}\s*ថ្ងៃ)|(?:ខន|ខុន)[ថធ][េិីើ]ន\s*(?:ផ្លែន|ផ្លេន|ផ្លាន)|កាលវិភាគបង្ហោះ/iu;
const audioNoun = /\b(?:audio|voice[ -]?over|narration|spoken audio|speech|voice recording)\b|សំឡេង|សម្លេង|សូរសំឡេង/iu;
// Khmer speech-to-text spells loanwords inconsistently ("poster" arrives as
// ប៉ូស្ទ័រ, ផូស្ទ័រ, ប៉ុស្ទ័រ, ពូសទ័រ...), and people say just "រូប" (picture).
// Missing those meant a spoken poster request never reached the generator.
// The poster spelling must end in ័/៍/រ so "ផុសទៅ Facebook" (post to
// Facebook) is not mistaken for a poster.
export const posterKhmerSpelling = /(?:ប៉|ផ|ព)[ូុោ]?(?:ស្ទ|សទ|ស្ធ|សធ)(?:[័៍]រ?|រ)/u;
const videoKhmerSpelling = /វីដេអូ|វិដេអូ|វីឌីអូ|វិឌីអូ|វីដីអូ/u;
export const mediaNoun = new RegExp(`\\b(?:image|photo|picture|poster|visual|logo|flyer|banner|video|reel|short film)\\b|រូបភាព|រូបថត|រូប(?=\\s|មួយ|$)|${posterKhmerSpelling.source}|ផ្ទាំងផ្សព្វផ្សាយ|ខិត្តប័ណ្ណ|បដា|ឡូហ្គោ|ឡូហ្កូ|${videoKhmerSpelling.source}`, 'iu');
const videoNoun = new RegExp(`\\b(?:video|reel|short film)s?\\b|${videoKhmerSpelling.source}`, 'iu');
const textContentNoun = /\b(?:content|caption|post|copy|script|hashtags?)\b|មាតិកា|ខ្លឹមសារ|ចំណងជើង|អត្ថបទ|ប៉ុស្ត៍|ប៉ុស្តិ៍|ផុស|ខេបសិន|ឃេបសិន|ខាប់សិន|ហាសថេក|ហាស់ថេក|ស្គ្រីប|ការប្រកាស/iu;
const goAhead = /^(?:yes|ok(?:ay)?|go ahead|do it|make it|create it|generate it|please do|ចាស|បាទ|យល់ព្រម|ធ្វើទៅ|បង្កើតទៅ|បង្កើតមក|សូមធ្វើ|សូមបង្កើត)[.!។\s]*$/iu;
const briefAnswer = /\b(?:voice|narration|silent|no sound|no voice|khmer|english|seconds?|tiktok|facebook|youtube)\b|\b\d\s*:\s*\d\b|សំឡេង|សម្លេង|ភាសាខ្មែរ|ភាសាអង់គ្លេស|មិនបាច់សំឡេង|វិនាទី/iu;

export const isVideoCreationFromPlanRequest = (message) => {
  const text = String(message || '').trim();
  const plan = planNoun.exec(text);
  const video = videoNoun.exec(text);
  if (!plan || !video || !creationVerb.test(text) || adviceQuestion.test(text)) return false;
  // In "create a video from the content plan", the video is the output and
  // the plan is its source. In "create a content plan for videos", the plan
  // itself is the output. Keep document/plan commands on their own path.
  const planIsSource = /(?:\b(?:from|using|based on|according to)\b|តាម|ពី)\s*(?:(?:my|our|the)\s*)?$/iu.test(text.slice(0, plan.index));
  return (video.index < plan.index && !/\bvideo\s+content\s+plan\b/iu.test(text))
    || (planIsSource && video.index > plan.index);
};

export const isContentPlanCreationRequest = (message) => {
  const text = String(message || '').trim();
  return planNoun.test(text) && creationVerb.test(text) && !adviceQuestion.test(text)
    && !isVideoCreationFromPlanRequest(text);
};

export const isStandaloneAudioRequest = (message) => {
  const text = String(message || '').trim();
  const audioIsTarget = /\b(?:create|make|generate|produce)\s+(?:a\s+|an\s+)?(?:audio|voice[ -]?over|narration|speech|voice recording)\b|(?:បង្កើត|ធ្វើ)\s*(?:សំឡេង|សម្លេង)/iu.test(text);
  return audioNoun.test(text) && creationVerb.test(text)
    && (!mediaNoun.test(text) || audioIsTarget) && !planNoun.test(text) && !adviceQuestion.test(text);
};

export const isTextContentCreationRequest = (message) => {
  const text = String(message || '').trim();
  return creationVerb.test(text) && textContentNoun.test(text)
    && !adviceQuestion.test(text) && !mediaNoun.test(text)
    && !isContentPlanCreationRequest(text);
};

export const shouldClassifyCreativeMedia = (message, historyText = '') => {
  const text = String(message || '').trim();
  if (isContentPlanCreationRequest(text) || isStandaloneAudioRequest(text)) return false;
  if (adviceQuestion.test(text)) return false;
  if (mediaNoun.test(text) && creationVerb.test(text)) return true;
  const recentHistory = String(historyText).slice(-1500);
  const lastAssistant = recentHistory.split('\n').filter((line) => line.startsWith('Assistant:')).at(-1) || '';
  const pendingMediaBrief = mediaNoun.test(recentHistory) && /\?|？|សូម|please|whether|which/iu.test(lastAssistant);
  return pendingMediaBrief && (goAhead.test(text) || briefAnswer.test(text));
};
