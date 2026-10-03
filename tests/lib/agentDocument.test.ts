import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import mammoth from 'mammoth';
import { createAgentDocumentBlob, isAgentDocumentCommand } from '../../src/lib/agentDocument';
import { dateMonthlyPlanRows, nextThirtyBangkokDates, normalizeAgentDocument, requestedAgentDocumentFormat } from '../../api/_agentDocument.js';

describe('agent document requests', () => {
  it('recognizes direct Khmer and English commands without treating advice as creation', () => {
    expect(requestedAgentDocumentFormat('សូមបង្កើតទម្រង់ Word សម្រាប់ផែនការមាតិកា')).toBe('docx');
    expect(requestedAgentDocumentFormat('Create an Excel content calendar')).toBe('xlsx');
    expect(requestedAgentDocumentFormat('How do I use Excel?')).toBeNull();
    expect(isAgentDocumentCommand('Create an Excel content calendar')).toBe(true);
    expect(requestedAgentDocumentFormat('សូមបង្កើត plan សម្រាប់មួយខែ')).toBe('xlsx');
    expect(isAgentDocumentCommand('សូមបង្កើត plan សម្រាប់មួយខែ')).toBe(true);
    expect(requestedAgentDocumentFormat('សូមរៀបចំផែនការមាតិកាមួយខែ')).toBe('xlsx');
    expect(requestedAgentDocumentFormat('How do I create a plan for one month?')).toBeNull();
  });

  it('turns a monthly plan into 30 dated rows for Bangkok time', () => {
    const dates = nextThirtyBangkokDates(new Date('2026-10-02T18:00:00Z'));
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe('2026-10-03');
    expect(dates[29]).toBe('2026-11-01');
    const document = normalizeAgentDocument({ title: 'Monthly plan', sheets: [{ name: 'Plan', columns: ['Date', 'Platform', 'Format', 'Topic', 'Hook', 'CTA'], rows: [['2026-10-03', 'Facebook', 'Video', 'Product demo', 'Watch this', 'Order now']] }] }, 'xlsx');
    const completed = dateMonthlyPlanRows(document, dates, 'English');
    expect(completed.sheets[0].rows).toHaveLength(30);
    expect(completed.sheets[0].rows[0]).toEqual(['2026-10-03', 'Facebook', 'Video', 'Product demo', 'Watch this', 'Order now']);
    expect(completed.sheets[0].rows[29][0]).toBe('2026-11-01');
    expect(completed.sheets[0].rows[29][3]).toContain('Draft idea:');
  });

  it('makes a Word file with Khmer content and XML escaped', async () => {
    const document = normalizeAgentDocument({ title: 'ផែនការ', sections: [{ heading: 'ចំណងជើង', paragraphs: ['អត្ថបទ & <test>'] }] }, 'docx');
    const bytes = new Uint8Array(await createAgentDocumentBlob(document).arrayBuffer());
    const files = unzipSync(bytes);
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('អត្ថបទ &amp; &lt;test&gt;');
    expect(files['[Content_Types].xml']).toBeTruthy();
    expect(files['word/styles.xml']).toBeTruthy();
    expect((await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value).toContain('អត្ថបទ & <test>');
  });

  it('makes an Excel file with headers and literal formula text', async () => {
    const document = normalizeAgentDocument({ title: 'Week', sheets: [{ name: 'Plan', columns: ['Day', 'Content'], rows: [['Monday', '=1+1']] }] }, 'xlsx');
    const bytes = new Uint8Array(await createAgentDocumentBlob(document).arrayBuffer());
    const files = unzipSync(bytes);
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>');
    expect(files['xl/workbook.xml']).toBeTruthy();
    expect(await readXlsxFile(Buffer.from(bytes))).toEqual([{ sheet: 'Plan', data: [['Day', 'Content'], ['Monday', '=1+1']] }]);
  });
});
