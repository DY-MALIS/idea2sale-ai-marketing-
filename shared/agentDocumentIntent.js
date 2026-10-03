const formatPattern = /\b(word|docx|excel|xlsx)\b|ឯកសារ\s*វើដ|សន្លឹក\s*អិចសែល/iu;
const excelPattern = /\b(excel|xlsx)\b|សន្លឹក\s*អិចសែល/iu;
const commandPattern = /\b(create|make|generate|prepare|write|export|download|convert|turn|send|give me)\b|បង្កើត|រៀបចំ|សរសេរ|ធ្វើ|ផ្ញើ|យក|ទាញយក|ចេញជា/iu;
const planPattern = /\b(?:content\s*)?plan\b|\bcalendar\b|ផែនការ|កាលវិភាគ/iu;
const monthPattern = /\b(?:a|one|1)\s*month\b|\bmonthly\b|\b(?:30|31)\s*days?\b|មួយ\s*ខែ|[១1]\s*ខែ|៣០\s*ថ្ងៃ|៣១\s*ថ្ងៃ|ខែនេះ|ខែក្រោយ/iu;
const advicePattern = /^\s*(?:how\s+(?:do|can|should)\s+i|what\s+(?:is|are)|why\b|តើ|របៀប)/iu;

export const isMonthlyPlanRequest = (message) => {
  const text = String(message || '').trim();
  return commandPattern.test(text) && planPattern.test(text) && monthPattern.test(text) && !advicePattern.test(text);
};

export const requestedAgentDocumentFormat = (message) => {
  const text = String(message || '').trim();
  if (!commandPattern.test(text) || advicePattern.test(text)) return null;
  if (formatPattern.test(text)) return excelPattern.test(text) ? 'xlsx' : 'docx';
  return isMonthlyPlanRequest(text) ? 'xlsx' : null;
};
