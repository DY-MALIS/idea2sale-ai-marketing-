import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import mammoth from 'mammoth';
import { createAgentDocumentBlob, isAgentDocumentCommand } from '../../src/lib/agentDocument';
import { normalizeAgentDocument, requestedAgentDocumentFormat } from '../../api/_agentDocument.js';

describe('agent document requests', () => {
  it('recognizes direct Khmer and English commands without treating advice as creation', () => {
    expect(requestedAgentDocumentFormat('សូមបង្កើតទម្រង់ Word សម្រាប់ផែនការមាតិកា')).toBe('docx');
    expect(requestedAgentDocumentFormat('Create an Excel content calendar')).toBe('xlsx');
    expect(requestedAgentDocumentFormat('How do I use Excel?')).toBeNull();
    expect(isAgentDocumentCommand('Create an Excel content calendar')).toBe(true);
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
