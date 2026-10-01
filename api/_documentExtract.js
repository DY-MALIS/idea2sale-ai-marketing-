// Import the implementation module directly, not the package root -- the
// root index.js has a `!module.parent` debug block meant for running the
// package standalone that misfires under ESM loaders (Vitest, Vercel's
// bundler) and eagerly reads a sample PDF fixture that doesn't exist outside
// the package's own repo, crashing at import time.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

// Business Profile's "upload an introduction" control: a user hands over a
// company brochure/profile document instead of typing a description by hand.
// Kept to plain-text extraction only (no OCR, no layout) -- the extracted
// text is immediately summarized by an LLM (see extractBusinessIntro in
// api/ai.js), so perfect fidelity here doesn't matter, only getting enough
// real words out of the file.
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 20000;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const EXTENSION_MIME = { txt: 'text/plain', pdf: 'application/pdf', docx: DOCX_MIME };

const extensionFromFileName = (fileName = '') => {
  const match = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
};

const typedError = (message, code, status = 400) => Object.assign(new Error(message), { code, status });

export async function extractDocumentText({ dataUrl, fileName }) {
  const match = String(dataUrl || '').match(/^data:([^;]*);base64,(.*)$/s);
  if (!match) throw typedError('Could not read this file.', 'invalid_data_url');
  const [, declaredMime, base64] = match;

  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw typedError('Could not read this file.', 'invalid_data_url');
  }
  if (!buffer.length) throw typedError('The uploaded file is empty.', 'empty_file');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw typedError('The uploaded file exceeds the 8 MB limit.', 'file_too_large', 413);

  const extension = extensionFromFileName(fileName);
  if (extension === 'doc') {
    throw typedError('The old .doc format is not supported. Save it as .docx, .pdf, or .txt and try again.', 'unsupported_file_type');
  }
  const mimeType = declaredMime && declaredMime !== 'application/octet-stream' ? declaredMime : EXTENSION_MIME[extension] || declaredMime;

  let rawText = '';
  if (mimeType === 'text/plain' || extension === 'txt') {
    rawText = buffer.toString('utf8');
  } else if (mimeType === 'application/pdf' || extension === 'pdf') {
    try {
      rawText = (await pdfParse(buffer)).text || '';
    } catch (error) {
      console.error('PDF text extraction failed:', error?.message || error);
      throw typedError('Could not read text from this PDF. It may be a scanned image without a text layer.', 'pdf_parse_failed');
    }
  } else if (mimeType === DOCX_MIME || extension === 'docx') {
    try {
      rawText = (await mammoth.extractRawText({ buffer })).value || '';
    } catch (error) {
      console.error('DOCX text extraction failed:', error?.message || error);
      throw typedError('Could not read text from this Word document.', 'docx_parse_failed');
    }
  } else {
    throw typedError('Upload a .txt, .pdf, or .docx file.', 'unsupported_file_type');
  }

  const trimmed = rawText.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw typedError('No readable text was found in this file.', 'no_text_found');
  return trimmed.slice(0, MAX_EXTRACTED_CHARS);
}
