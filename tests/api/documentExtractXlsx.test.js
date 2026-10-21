import { expect, it } from 'vitest';
import { createAgentDocumentBlob } from '../../src/lib/agentDocument.js';
import { extractDocumentText } from '../../api/_documentExtract.js';

it('reads the cells of an uploaded Excel workbook for Agent knowledge', async () => {
  const blob = createAgentDocumentBlob({ format: 'xlsx', title: 'Prices', sheets: [{ name: 'Products', columns: ['Item', 'Price'], rows: [['Coffee', '2 USD']] }] });
  const buffer = Buffer.from(await blob.arrayBuffer());
  const text = await extractDocumentText({ dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString('base64')}`, fileName: 'prices.xlsx' });
  expect(text).toContain('Products');
  expect(text).toContain('Coffee | 2 USD');
});
