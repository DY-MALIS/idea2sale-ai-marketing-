const editVerb = /\b(?:edit|update|change|revise|modify|replace|reschedule)\b|កែប្រែ|កែ|ផ្លាស់ប្តូរ|ប្តូរ|ធ្វើបច្ចុប្បន្នភាព|ជំនួស/iu;
const planReference = /\b(?:content\s*plan|calendar|plan|post|row|item|day|date)\b|ផែនការ|កាលវិភាគ|មាតិកា|ប្រកាស|ជួរ|ថ្ងៃទី|ថ្ងៃ/iu;

export const isContentPlanEditRequest = (message) => {
  const text = String(message || '').trim();
  return editVerb.test(text) && planReference.test(text);
};
