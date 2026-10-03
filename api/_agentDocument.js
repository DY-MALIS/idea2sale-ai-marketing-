import { generateOpenRouterText, resolveOpenRouterTextModel } from './_openrouter.js';

const formatPattern = /\b(word|docx|excel|xlsx)\b|ឯកសារ\s*វើដ|សន្លឹក\s*អិចសែល/iu;
const commandPattern = /\b(create|make|generate|prepare|write|export|download|convert|turn|send|give me)\b|បង្កើត|រៀបចំ|សរសេរ|ធ្វើ|ផ្ញើ|យក|ទាញយក|ចេញជា/iu;

export const requestedAgentDocumentFormat = (message) => {
  const text = String(message || '');
  if (!formatPattern.test(text) || !commandPattern.test(text)) return null;
  return /\b(excel|xlsx)\b|សន្លឹក\s*អិចសែល/iu.test(text) ? 'xlsx' : 'docx';
};

const value = (input, max = 500) => String(input ?? '').trim().slice(0, max);

export const normalizeAgentDocument = (raw, format) => {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); }
    catch {
      const object = raw.match(/\{[\s\S]*\}/);
      if (!object) throw new Error('The generated document could not be read.');
      parsed = JSON.parse(object[0]);
    }
  }
  const title = value(parsed?.title, 100) || (format === 'xlsx' ? 'Spreadsheet' : 'Document');
  // Conversations are stored in Firestore with recent sessions, so keep each
  // editable document draft bounded well below the 1 MB document limit.
  let remaining = 10_000;
  const bounded = (input, max) => {
    const text = value(input, max).slice(0, remaining);
    remaining -= text.length;
    return text;
  };
  if (format === 'docx') {
    const sections = (Array.isArray(parsed?.sections) ? parsed.sections : []).slice(0, 15)
      .map((section) => ({
        heading: bounded(section?.heading, 120),
        paragraphs: (Array.isArray(section?.paragraphs) ? section.paragraphs : []).slice(0, 8)
          .map((paragraph) => bounded(paragraph, 1200)).filter(Boolean),
      })).filter((section) => section.heading || section.paragraphs.length);
    if (!sections.length) throw new Error('The Word document has no content.');
    return { format, title, sections };
  }
  const sheets = (Array.isArray(parsed?.sheets) ? parsed.sheets : []).slice(0, 3)
    .map((sheet, index) => {
      const columns = (Array.isArray(sheet?.columns) ? sheet.columns : []).slice(0, 10).map((cell) => bounded(cell, 100));
      const rows = (Array.isArray(sheet?.rows) ? sheet.rows : []).slice(0, 40)
        .map((row) => columns.map((_, column) => bounded(Array.isArray(row) ? row[column] : '', 400)))
        .filter((row) => row.some(Boolean));
      return { name: value(sheet?.name, 31) || `Sheet ${index + 1}`, columns, rows };
    }).filter((sheet) => sheet.columns.length && sheet.rows.length);
  if (!sheets.length) throw new Error('The Excel workbook has no rows.');
  return { format, title, sheets };
};

export const generateAgentDocument = async ({ format, message, historyText, businessContextText, responseLanguage }) => {
  const raw = await generateOpenRouterText({
    system: `Create the actual content for a downloadable ${format === 'xlsx' ? 'Excel workbook' : 'Word document'} requested by the user. Return only valid JSON. Write user-facing content in ${responseLanguage}; keep names and technical terms as the user used them. Use the recent conversation and saved business profile to resolve short follow-ups. Make a useful, complete first draft immediately. If the user asks for a template, include practical headings and example or blank-ready rows. Do not invent specific private figures or claim live research. Never include markdown fences.`,
    model: resolveOpenRouterTextModel(),
    temperature: 0.35,
    maxTokens: 6500,
    responseFormat: { type: 'json_object' },
    prompt: `Saved business profile:\n${businessContextText}\n\nRecent conversation:\n${historyText || 'None'}\n\nLatest request:\n${message}\n\nReturn exactly this JSON structure: ${format === 'xlsx'
      ? '{"title":"workbook title","sheets":[{"name":"sheet name","columns":["column 1","column 2"],"rows":[["cell 1","cell 2"]]}]}. Include up to 3 sheets, 10 columns, and 40 meaningful rows per sheet.'
      : '{"title":"document title","sections":[{"heading":"section heading","paragraphs":["complete paragraph or bullet text"]}]}. Include useful detail in multiple sections.'}`,
  });
  return normalizeAgentDocument(raw, format);
};
