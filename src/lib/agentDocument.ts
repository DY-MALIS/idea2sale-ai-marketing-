import { strToU8, zipSync } from 'fflate';

export interface AgentDocument {
  format: 'docx' | 'xlsx';
  title: string;
  sections?: { heading: string; paragraphs: string[] }[];
  sheets?: { name: string; columns: string[]; rows: string[][] }[];
}

export const isAgentDocumentCommand = (message: string) => (
  (/\b(word|docx|excel|xlsx)\b|ឯកសារ\s*វើដ|សន្លឹក\s*អិចសែល/iu.test(message)
    && /\b(create|make|generate|prepare|write|export|download|convert|turn|send|give me)\b|បង្កើត|រៀបចំ|សរសេរ|ធ្វើ|ផ្ញើ|យក|ទាញយក|ចេញជា/iu.test(message))
);

const xml = (value: unknown) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const packageRels = `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${'TARGET'}"/></Relationships>`;
const zipFiles = (files: Record<string, string>) => new Blob(
  [zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strToU8(data)]))) as BlobPart],
  { type: 'application/octet-stream' },
);

const wordParagraph = (text: string, heading = false) => `<w:p>${heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;

const makeWord = (document: AgentDocument) => {
  const body = [wordParagraph(document.title, true), ...(document.sections || []).flatMap((section) => [
    ...(section.heading ? [wordParagraph(section.heading, true)] : []),
    ...section.paragraphs.map((paragraph) => wordParagraph(paragraph)),
  ])].join('');
  return zipFiles({
    '[Content_Types].xml': `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': packageRels.replace('TARGET', 'word/document.xml'),
    'word/document.xml': `${declaration}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`,
    'word/styles.xml': `${declaration}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  });
};

const excelColumn = (index: number) => {
  let column = '';
  for (let number = index + 1; number; number = Math.floor((number - 1) / 26)) column = String.fromCharCode(65 + ((number - 1) % 26)) + column;
  return column;
};
const excelRow = (cells: string[], rowNumber: number, header = false) => `<row r="${rowNumber}">${cells.map((cell, index) => `<c r="${excelColumn(index)}${rowNumber}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(cell)}</t></is></c>`).join('')}</row>`;

const makeExcel = (document: AgentDocument) => {
  const sheets = document.sheets || [];
  const files: Record<string, string> = {
    '[Content_Types].xml': `${declaration}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': packageRels.replace('TARGET', 'xl/workbook.xml'),
    'xl/workbook.xml': `${declaration}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name.replace(/[\\/?*\[\]:]/g, '').slice(0, 31) || `Sheet ${index + 1}`)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${declaration}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${declaration}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
  };
  sheets.forEach((sheet, index) => {
    const rows = [excelRow(sheet.columns, 1, true), ...sheet.rows.map((row, rowIndex) => excelRow(row, rowIndex + 2))].join('');
    files[`xl/worksheets/sheet${index + 1}.xml`] = `${declaration}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${excelColumn(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><sheetData>${rows}</sheetData><autoFilter ref="A1:${excelColumn(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}"/></worksheet>`;
  });
  return zipFiles(files);
};

export const createAgentDocumentBlob = (document: AgentDocument) => document.format === 'xlsx' ? makeExcel(document) : makeWord(document);

export const downloadAgentDocument = (document: AgentDocument) => {
  const blob = createAgentDocumentBlob(document);
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = `${document.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim().slice(0, 80) || 'document'}.${document.format}`;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
