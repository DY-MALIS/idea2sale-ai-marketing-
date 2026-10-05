import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pdfParse: vi.fn(),
  extractRawText: vi.fn(),
}));
vi.mock('pdf-parse/lib/pdf-parse.js', () => ({ default: mocks.pdfParse }));
vi.mock('mammoth', () => ({ default: { extractRawText: mocks.extractRawText } }));

const { extractDocumentText } = await import('../../api/_documentExtract.js');

afterEach(() => { vi.resetAllMocks(); });

const dataUrl = (mime, text) => `data:${mime};base64,${Buffer.from(text, 'utf8').toString('base64')}`;

it('reads a plain text file directly, with no parsing library involved', async () => {
  const text = await extractDocumentText({ dataUrl: dataUrl('text/plain', 'We sell handmade soap.'), fileName: 'intro.txt' });
  expect(text).toBe('We sell handmade soap.');
  expect(mocks.pdfParse).not.toHaveBeenCalled();
});

it('falls back to the file extension when the declared MIME type is generic', async () => {
  const raw = dataUrl('application/octet-stream', 'A bakery in Phnom Penh.');
  const text = await extractDocumentText({ dataUrl: raw, fileName: 'about.txt' });
  expect(text).toBe('A bakery in Phnom Penh.');
});

it('extracts PDF text via pdf-parse and collapses whitespace', async () => {
  mocks.pdfParse.mockResolvedValue({ text: 'Line one\n\n  Line   two  ' });
  const text = await extractDocumentText({ dataUrl: dataUrl('application/pdf', 'ignored-binary-stub'), fileName: 'profile.pdf' });
  expect(text).toBe('Line one Line two');
  expect(mocks.pdfParse).toHaveBeenCalledTimes(1);
});

it('wraps a pdf-parse failure in a typed, user-facing error', async () => {
  mocks.pdfParse.mockRejectedValue(new Error('bad xref table'));
  await expect(extractDocumentText({ dataUrl: dataUrl('application/pdf', 'x'), fileName: 'profile.pdf' }))
    .rejects.toMatchObject({ code: 'pdf_parse_failed', status: 400 });
});

it('extracts DOCX text via mammoth', async () => {
  mocks.extractRawText.mockResolvedValue({ value: 'We offer web design services.' });
  const text = await extractDocumentText({
    dataUrl: dataUrl('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'ignored-zip-stub'),
    fileName: 'company.docx',
  });
  expect(text).toBe('We offer web design services.');
  expect(mocks.extractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
});

it('rejects the legacy .doc format with guidance instead of attempting to parse it', async () => {
  await expect(extractDocumentText({ dataUrl: dataUrl('application/msword', 'x'), fileName: 'old.doc' }))
    .rejects.toMatchObject({ code: 'unsupported_file_type' });
  expect(mocks.extractRawText).not.toHaveBeenCalled();
});

it('reads a code/markup file as plain text instead of rejecting its extension', async () => {
  const text = await extractDocumentText({ dataUrl: dataUrl('application/json', '{"name": "Handmade Soap Co"}'), fileName: 'profile.json' });
  expect(text).toBe('{"name": "Handmade Soap Co"}');
});

it('rejects a binary file slipped in under an unrecognized extension', async () => {
  const binary = `data:application/octet-stream;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]).toString('base64')}`;
  await expect(extractDocumentText({ dataUrl: binary, fileName: 'logo.png' }))
    .rejects.toMatchObject({ code: 'unsupported_file_type' });
});

it('rejects a malformed data URL', async () => {
  await expect(extractDocumentText({ dataUrl: 'not-a-data-url', fileName: 'intro.txt' }))
    .rejects.toMatchObject({ code: 'invalid_data_url' });
});

it('rejects an empty file', async () => {
  await expect(extractDocumentText({ dataUrl: 'data:text/plain;base64,', fileName: 'intro.txt' }))
    .rejects.toMatchObject({ code: 'empty_file' });
});

it('rejects a file larger than the 8 MB limit', async () => {
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 97).toString('base64');
  await expect(extractDocumentText({ dataUrl: `data:text/plain;base64,${big}`, fileName: 'intro.txt' }))
    .rejects.toMatchObject({ code: 'file_too_large', status: 413 });
});

it('rejects a file whose extracted text is only whitespace', async () => {
  mocks.pdfParse.mockResolvedValue({ text: '   \n\n  ' });
  await expect(extractDocumentText({ dataUrl: dataUrl('application/pdf', 'x'), fileName: 'scan.pdf' }))
    .rejects.toMatchObject({ code: 'no_text_found' });
});
