import { generateOpenRouterText, resolveOpenRouterTextModel } from './_openrouter.js';
import { isMonthlyPlanRequest } from '../shared/agentDocumentIntent.js';
import { isContentPlanCreationRequest } from '../shared/agentIntent.js';
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

export const contentPlanDayCount = (message) => {
  if (isMonthlyPlanRequest(message)) return 30;
  if (!isContentPlanCreationRequest(message)) return 0;
  const text = String(message).replace(/[០-៩]/g, (digit) => String('០១២៣៤៥៦៧៨៩'.indexOf(digit)));
  const count = text.match(/\b(\d{1,2})\s*(?:days?|posts?)\b|(?:days?|posts?)\s*(\d{1,2})\b|(\d{1,2})\s*(?:ថ្ងៃ|ចំណុច)/iu);
  return Math.min(30, Math.max(1, count ? Number(count[1] || count[2] || count[3]) : 7));
};

export const generateAgentDocument = async ({ format, message, historyText, businessContextText, responseLanguage }) => {
  const planDays = format === 'xlsx' ? contentPlanDayCount(message) : 0;
  const model = resolveOpenRouterTextModel();
  const baseRequest = {
    system: `Create the actual content for a downloadable ${format === 'xlsx' ? 'Excel workbook' : 'Word document'} requested by the user. Return only valid JSON. Write user-facing content in ${responseLanguage}; keep names and technical terms as the user used them. Use the recent conversation and saved business profile to resolve short follow-ups. Make a useful, complete first draft immediately. If the user asks for a template, include practical headings and example or blank-ready rows. Do not invent specific private figures or claim live research. Never include markdown fences.${planDays ? ' This is a direct command for a dated content plan: create one practical marketing content calendar row for each date supplied in this batch. Do not answer conversationally, ask questions, or return fewer dates. Make each daily idea distinct and actionable.' : ''}`,
    model,
    temperature: 0.35,
    reasoningEffort: 'low',
    responseFormat: { type: 'json_object' },
  };
  const requestContext = `Saved business profile:\n${businessContextText}\n\nRecent conversation:\n${historyText || 'None'}\n\nLatest request:\n${message}\n\n`;
  const xlsxStructure = '{"title":"workbook title","sheets":[{"name":"sheet name","columns":["column 1","column 2"],"rows":[["cell 1","cell 2"]]}]}. Include up to 3 sheets, 10 columns, and 40 meaningful rows per sheet.';
  const generateReadableDocument = async (request, expectedRows = 0) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await generateOpenRouterText({
          ...baseRequest,
          ...request,
          prompt: `${request.prompt}${attempt ? '\n\nThe previous response was empty, malformed, or missing rows. Return one complete JSON object with every requested row.' : ''}`,
        });
        const document = normalizeAgentDocument(raw, format);
        if (expectedRows && (
          document.sheets[0].columns.length < 6
          || document.sheets[0].rows.length < expectedRows
          || document.sheets[0].rows.slice(0, expectedRows).some((row) => row.filter(Boolean).length < 4)
        )) throw new Error('The Excel workbook has missing content-plan rows.');
        return document;
      } catch (error) {
        // A truncated HTTP JSON body can fail inside generateOpenRouterText,
        // before normalizeAgentDocument sees the model text. Retry that same
        // recoverable parse failure without retrying credential or credit errors.
        const responseParseFailed = error instanceof SyntaxError;
        const documentParseFailed = /generated document could not be read|document has no content|workbook has no rows|missing content-plan rows/i.test(String(error?.message || ''));
        if (!responseParseFailed && !documentParseFailed) throw error;
        if (attempt) throw new Error('The AI could not produce a readable document. Please try again.');
        console.warn('Agent document response was incomplete; retrying once:', error?.message || error);
      }
    }
  };

  if (planDays) {
    const dates = nextThirtyBangkokDates().slice(0, planDays);
    // A single 30-row JSON reply can exhaust its output budget before closing
    // the object. Smaller complete replies are much more reliable for Khmer
    // content, and each batch can be retried without repeating the whole month.
    const batches = await Promise.all(Array.from({ length: Math.ceil(planDays / 10) }, (_, batch) => batch * 10).map((start) => {
      const batchDates = dates.slice(start, start + 10);
      return generateReadableDocument({
        maxTokens: 5000,
        prompt: `${requestContext}Create exactly one distinct, actionable content-calendar row for each of these ${batchDates.length} dates, in this order: ${batchDates.join(', ')}. Use columns Date, Platform, Format, Topic, Hook, CTA. Keep each cell concise and fill all ${batchDates.length} rows. Return exactly this JSON structure: ${xlsxStructure}`,
      }, batchDates.length);
    }));
    const firstSheet = batches[0].sheets[0];
    const rows = batches.flatMap((batch) => batch.sheets[0].rows.slice(0, 10));
    return dateMonthlyPlanRows({ ...batches[0], sheets: [{ ...firstSheet, rows }] }, dates, responseLanguage);
  }

  return generateReadableDocument({
    maxTokens: 6500,
    prompt: `${requestContext}Return exactly this JSON structure: ${format === 'xlsx'
      ? xlsxStructure
      : '{"title":"document title","sections":[{"heading":"section heading","paragraphs":["complete paragraph or bullet text"]}]}. Include useful detail in multiple sections.'}`,
  });
};
