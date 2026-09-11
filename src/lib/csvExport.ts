// Plain CSV rather than a real .xlsx: the only maintained way to generate
// .xlsx client-side (the `xlsx` npm package) ships a known high-severity
// prototype-pollution vulnerability with no fix published to the npm
// registry (SheetJS only patches it on their own CDN). Excel opens CSV
// natively, so this gets the same practical result -- a spreadsheet the
// user can open, filter, and share -- without adding that risk.
const escapeCsvCell = (value: unknown): string => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const downloadCsv = (filename: string, rows: unknown[][]): void => {
  const csvBody = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  // UTF-8 BOM so Excel detects the encoding correctly and renders Khmer
  // script instead of garbled text -- Excel assumes ANSI without it.
  const blob = new Blob(['﻿', csvBody], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};
