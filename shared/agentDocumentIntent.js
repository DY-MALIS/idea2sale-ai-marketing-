import { isContentPlanCreationRequest, isVideoCreationFromPlanRequest } from './agentIntent.js';

// Khmer speech-to-text spells "Word"/"Excel" several ways (វើដ, វឺដ, វើត;
// អ៊ិចសែល, អិកសែល, អេចសែល...).
const excelPattern = /\b(excel|xlsx|spreadsheet)\b|(?:អ៊|អ)?[ិីេ][ចកគ]សែល/iu;
const formatPattern = /\b(word|docx|excel|xlsx|spreadsheet)\b|(?:ឯកសារ|ហ្វាល់|ហ្វាល)\s*វ[ើឺ][ដត]|វ[ើឺ][ដត]\s*(?:ហ្វាល់|ហ្វាល|ឯកសារ)|(?:អ៊|អ)?[ិីេ][ចកគ]សែល/iu;
const commandPattern = /\b(create|make|generate|prepare|write|export|download|convert|turn|send|give me|want|need)\b|បង្កើត|រៀបចំ|សរសេរ|ធ្វើ|ផ្ញើ|យក|ទាញយក|ចេញជា|ចង់បាន|ត្រូវការ/iu;
const planPattern = /\b(?:content\s*)?plan\b|\bcalendar\b|ផែនការ|កាលវិភាគ/iu;
const monthPattern = /\b(?:a|one|1)\s*month\b|\bmonthly\b|\b(?:30|31)\s*days?\b|មួយ\s*ខែ|[១1]\s*ខែ|៣០\s*ថ្ងៃ|៣១\s*ថ្ងៃ|ខែនេះ|ខែក្រោយ/iu;
const advicePattern = /^\s*(?:how\s+(?:do|can|should)\s+i|what\s+(?:is|are)|why\b|តើ|របៀប)/iu;

export const isMonthlyPlanRequest = (message) => {
  const text = String(message || '').trim();
  return commandPattern.test(text) && planPattern.test(text) && monthPattern.test(text) && !advicePattern.test(text);
};

export const requestedAgentDocumentFormat = (message, { preferSpreadsheetForPlan = false } = {}) => {
  const text = String(message || '').trim();
  if (isVideoCreationFromPlanRequest(text)) return null;
  if (preferSpreadsheetForPlan && isContentPlanCreationRequest(text)) return 'xlsx';
  if (!commandPattern.test(text) || advicePattern.test(text)) return null;
  if (formatPattern.test(text)) return excelPattern.test(text) ? 'xlsx' : 'docx';
  return isMonthlyPlanRequest(text) ? 'xlsx' : null;
};
