import { generateOpenRouterText, resolveOpenRouterTextModel } from './_openrouter.js';
import { isMonthlyPlanRequest } from '../shared/agentDocumentIntent.js';
export { requestedAgentDocumentFormat } from '../shared/agentDocumentIntent.js';

const value = (input, max = 500) => String(input ?? '').trim().slice(0, max);

export const nextThirtyBangkokDates = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type) => Number(parts.find((entry) => entry.type === type)?.value);
  const start = Date.UTC(part('year'), part('month') - 1, part('day'));
  return Array.from({ length: 30 }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
};

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

export const dateMonthlyPlanRows = (document, dates, responseLanguage) => {
  const sheet = document.sheets?.[0];
  if (!sheet) throw new Error('The monthly plan has no sheet.');
  const english = responseLanguage === 'English';
  const fallbackTopics = english
    ? ['Introduce the offer', 'Customer problem', 'Helpful tip', 'Product demonstration', 'Common question', 'Customer story', 'Call to action']
    : ['ណែនាំផលិតផល', 'បញ្ហារបស់អតិថិជន', 'គន្លឹះមានប្រយោជន៍', 'បង្ហាញផលិតផល', 'សំណួរញឹកញាប់', 'បទពិសោធន៍អតិថិជន', 'អញ្ជើញឱ្យទាក់ទង'];
  const rows = dates.map((date, index) => {
    const source = sheet.rows[index] || [];
    const values = /^\d{4}-\d{2}-\d{2}$/.test(source[0] || '') ? source.slice(1) : source;
    if (values.some(Boolean)) return [date, ...Array.from({ length: 5 }, (_, column) => values[column] || '')];
    const topic = fallbackTopics[index % fallbackTopics.length];
    return english
      ? [date, 'Facebook', 'Post', `Draft idea: ${topic} (week ${Math.floor(index / 7) + 1})`, `Share one useful point about ${topic.toLowerCase()}.`, 'Message us']
      : [date, 'Facebook', 'Post', `គំនិតបឋម៖ ${topic} (សប្តាហ៍ទី ${Math.floor(index / 7) + 1})`, `ចែករំលែកចំណុចសំខាន់មួយអំពី${topic}។`, 'ផ្ញើសារមកយើង'];
  });
  const columns = english
    ? ['Date', 'Platform', 'Format', 'Topic', 'Hook', 'CTA']
    : ['កាលបរិច្ឆេទ', 'បណ្តាញ', 'ទម្រង់', 'ប្រធានបទ', 'Hook', 'CTA'];
  return { ...document, sheets: [{ name: sheet.name, columns, rows }] };
};

export const generateAgentDocument = async ({ format, message, historyText, businessContextText, responseLanguage }) => {
  const monthlyPlan = format === 'xlsx' && isMonthlyPlanRequest(message);
  const dates = monthlyPlan ? nextThirtyBangkokDates() : [];
  const raw = await generateOpenRouterText({
    system: `Create the actual content for a downloadable ${format === 'xlsx' ? 'Excel workbook' : 'Word document'} requested by the user. Return only valid JSON. Write user-facing content in ${responseLanguage}; keep names and technical terms as the user used them. Use the recent conversation and saved business profile to resolve short follow-ups. Make a useful, complete first draft immediately. If the user asks for a template, include practical headings and example or blank-ready rows. Do not invent specific private figures or claim live research. Never include markdown fences.${monthlyPlan ? ' This is a direct command for a one-month plan: create one practical marketing content calendar row for each of the 30 dates supplied. Do not answer conversationally, ask questions, or return fewer dates. Make each daily idea distinct and actionable.' : ''}`,
    model: resolveOpenRouterTextModel(),
    temperature: 0.35,
    maxTokens: monthlyPlan ? 10_000 : 6500,
    responseFormat: { type: 'json_object' },
    prompt: `Saved business profile:\n${businessContextText}\n\nRecent conversation:\n${historyText || 'None'}\n\nLatest request:\n${message}\n\n${monthlyPlan ? `Create exactly one row per date, in this order: ${dates.join(', ')}. Use columns Date, Platform, Format, Topic, Hook, CTA. Keep each cell concise and fill all 30 rows.\n\n` : ''}Return exactly this JSON structure: ${format === 'xlsx'
      ? '{"title":"workbook title","sheets":[{"name":"sheet name","columns":["column 1","column 2"],"rows":[["cell 1","cell 2"]]}]}. Include up to 3 sheets, 10 columns, and 40 meaningful rows per sheet.'
      : '{"title":"document title","sections":[{"heading":"section heading","paragraphs":["complete paragraph or bullet text"]}]}. Include useful detail in multiple sections.'}`,
  });
  let document = normalizeAgentDocument(raw, format);
  if (!monthlyPlan) return document;
  if (document.sheets[0].rows.length < dates.length) {
    const firstSheet = document.sheets[0];
    const remainingDates = dates.slice(firstSheet.rows.length);
    try {
      const continuation = await generateOpenRouterText({
        system: `Continue a monthly marketing content calendar. Return only valid JSON in ${responseLanguage}. Every requested date needs a distinct, actionable idea.`,
        model: resolveOpenRouterTextModel(),
        temperature: 0.35,
        maxTokens: 7000,
        responseFormat: { type: 'json_object' },
        prompt: `Original request: ${message}\nBusiness: ${businessContextText}\nAlready covered dates: ${dates.slice(0, firstSheet.rows.length).join(', ')}\nFill ONLY these remaining dates, in order: ${remainingDates.join(', ')}. Return {"title":"Continuation","sheets":[{"name":"Plan","columns":["Date","Platform","Format","Topic","Hook","CTA"],"rows":[["date","platform","format","topic","hook","cta"]]}]}. Include exactly ${remainingDates.length} rows.`,
      });
      const extra = normalizeAgentDocument(continuation, 'xlsx');
      document = { ...document, sheets: [{ ...firstSheet, rows: [...firstSheet.rows, ...extra.sheets[0].rows] }] };
    } catch (error) {
      console.error('Monthly plan continuation failed:', error?.message || error);
    }
  }
  return dateMonthlyPlanRows(document, dates, responseLanguage);
};
