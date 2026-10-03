const editVerb = /\b(?:edit|update|change|revise|modify|replace|reschedule|add|insert|remove|delete)\b|កែប្រែ|កែ|ផ្លាស់ប្តូរ|ប្តូរ|ធ្វើបច្ចុប្បន្នភាព|ជំនួស|បន្ថែម|បញ្ចូល|លុប|ដក/iu;
const planReference = /\b(?:content\s*plan|calendar|plan|post|row|item|day|date)\b|ផែនការ|កាលវិភាគ|មាតិកា|ប្រកាស|ជួរ|ថ្ងៃទី|ថ្ងៃ/iu;
const targetedMake = /\b(?:make|create|turn)\b|ធ្វើ|បង្កើត/iu;
const rowReference = /\b(?:row|item|day)\s*(?:\d+|one|two|three|four|five)\b|(?:ជួរ|ថ្ងៃទី)\s*[០-៩0-9]+/iu;

export const isContentPlanEditRequest = (message) => {
  const text = String(message || '').trim();
  return (editVerb.test(text) && planReference.test(text)) || (targetedMake.test(text) && rowReference.test(text));
};

export const isContentPlanEditFollowup = (message) => {
  const text = String(message || '').trim();
  return editVerb.test(text) || (targetedMake.test(text) && /\b(?:it|that|this)\b|វា|នោះ|នេះ/iu.test(text));
};
