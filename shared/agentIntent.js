const creationVerb = /\b(?:create|make|generate|produce|draft|build|prepare|design)\b|បង្កើត|ធ្វើ|រៀបចំ|សរសេរ|ផលិត|សូមបង្កើត/iu;
const adviceQuestion = /^(?:how|why|what|which|should|can you explain|របៀប|ហេតុអ្វី|យ៉ាងដូចម្តេច|តើ.+(?:អ្វី|យ៉ាងណា))/iu;
const planNoun = /\b(?:content\s*plan(?:ner)?|content\s*calendar|posting\s*calendar|plan\s+for\s+content)\b|ផែនការ\s*(?:មាតិកា|ខ្លឹមសារ|បង្ហោះ|content)|កាលវិភាគបង្ហោះ/iu;
const audioNoun = /\b(?:audio|voice[ -]?over|narration|spoken audio|speech|voice recording)\b|សំឡេង|សម្លេង|សូរសំឡេង/iu;
const mediaNoun = /\b(?:image|photo|poster|visual|logo|flyer|banner|video|reel|short film)\b|រូបភាព|រូបថត|ប៉ូស្ទ័រ|ឡូហ្គោ|វីដេអូ/iu;
const goAhead = /^(?:yes|ok(?:ay)?|go ahead|do it|make it|create it|generate it|please do|ចាស|បាទ|យល់ព្រម|ធ្វើទៅ|បង្កើតទៅ|បង្កើតមក|សូមធ្វើ|សូមបង្កើត)[.!។\s]*$/iu;
const briefAnswer = /\b(?:voice|narration|silent|no sound|no voice|khmer|english|seconds?|tiktok|facebook|youtube)\b|\b\d\s*:\s*\d\b|សំឡេង|សម្លេង|ភាសាខ្មែរ|ភាសាអង់គ្លេស|មិនបាច់សំឡេង|វិនាទី/iu;

export const isContentPlanCreationRequest = (message) => {
  const text = String(message || '').trim();
  return planNoun.test(text) && creationVerb.test(text) && !adviceQuestion.test(text);
};

export const isStandaloneAudioRequest = (message) => {
  const text = String(message || '').trim();
  const audioIsTarget = /\b(?:create|make|generate|produce)\s+(?:a\s+|an\s+)?(?:audio|voice[ -]?over|narration|speech|voice recording)\b|(?:បង្កើត|ធ្វើ)\s*(?:សំឡេង|សម្លេង)/iu.test(text);
  return audioNoun.test(text) && creationVerb.test(text)
    && (!mediaNoun.test(text) || audioIsTarget) && !planNoun.test(text) && !adviceQuestion.test(text);
};

export const shouldClassifyCreativeMedia = (message, historyText = '') => {
  const text = String(message || '').trim();
  if (isContentPlanCreationRequest(text) || isStandaloneAudioRequest(text)) return false;
  if (mediaNoun.test(text) && creationVerb.test(text)) return true;
  const recentHistory = String(historyText).slice(-1500);
  const lastAssistant = recentHistory.split('\n').filter((line) => line.startsWith('Assistant:')).at(-1) || '';
  const pendingMediaBrief = mediaNoun.test(recentHistory) && /\?|？|សូម|please|whether|which/iu.test(lastAssistant);
  return pendingMediaBrief && (goAhead.test(text) || briefAnswer.test(text));
};
