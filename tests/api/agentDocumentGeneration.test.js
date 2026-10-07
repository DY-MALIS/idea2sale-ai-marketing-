import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({
  generateOpenRouterText: mocks.generateText,
  resolveOpenRouterTextModel: () => 'test/model',
}));

import { generateAgentDocument } from '../../api/_agentDocument.js';
import { createAgentDocumentBlob } from '../../src/lib/agentDocument.ts';
import readXlsxFile from 'read-excel-file/node';

const request = {
  format: 'xlsx',
  message: 'Create an Excel content plan for one month',
  historyText: '',
  businessContextText: 'Business name: DGACADEMY\nBusiness description: AI training and systems',
  responseLanguage: 'English',
};

describe('agent document generation', () => {
  beforeEach(() => { mocks.generateText.mockReset(); });

  it('returns a seven-row Excel plan for a seven-day spoken request', async () => {
    mocks.generateText.mockImplementation(async ({ prompt }) => {
      const dates = prompt.match(/in this order: ((?:\d{4}-\d{2}-\d{2},?\s*){7})/)?.[1].match(/\d{4}-\d{2}-\d{2}/g) || [];
      return JSON.stringify({
        title: 'Weekly content plan',
        sheets: [{
          name: 'Plan',
          columns: ['Date', 'Platform', 'Format', 'Topic', 'Hook', 'CTA'],
          rows: dates.map((date) => [date, 'Facebook', 'Post', `Idea for ${date}`, 'Learn AI', 'Contact us']),
        }],
      });
    });
    const document = await generateAgentDocument({ ...request, message: 'សូមបង្កើត Content Plan ៧ ថ្ងៃសម្រាប់ DGACADEMY' });
    expect(document.format).toBe('xlsx');
    expect(document.sheets[0].rows).toHaveLength(7);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it('makes a complete monthly Excel plan in small batches and retries truncated JSON', async () => {
    let failedOnce = false;
    mocks.generateText.mockImplementation(async ({ prompt }) => {
      const match = prompt.match(/in this order: ((?:\d{4}-\d{2}-\d{2},?\s*){10})/);
      const dates = match?.[1].match(/\d{4}-\d{2}-\d{2}/g) || [];
      if (dates.length !== 10) throw new Error('Expected ten dates in each batch');
      if (!failedOnce) {
        failedOnce = true;
        return '{"title":"DGACADEMY content plan","sheets":[';
      }
      return JSON.stringify({
        title: 'DGACADEMY content plan',
        sheets: [{
          name: 'Plan',
          columns: ['Date', 'Platform', 'Format', 'Topic', 'Hook', 'CTA'],
          rows: dates.map((date) => [date, 'Facebook', 'Post', `DGACADEMY idea for ${date}`, 'Learn AI', 'Contact DGACADEMY']),
        }],
      });
    });
    const document = await generateAgentDocument(request);
    expect(document.sheets[0].rows).toHaveLength(30);
    expect(document.sheets[0].rows[0][3]).toContain('DGACADEMY');
    expect(document.sheets[0].rows[29][3]).toContain('DGACADEMY');
    expect(mocks.generateText).toHaveBeenCalledTimes(4);
    expect(mocks.generateText.mock.calls.every(([options]) => options.reasoningEffort === 'low' && options.maxTokens === 5000)).toBe(true);
  });

  it('retries an empty document response before returning a Word draft', async () => {
    mocks.generateText
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(JSON.stringify({ title: 'DGACADEMY profile', sections: [{ heading: 'About', paragraphs: ['AI training and systems'] }] }));
    const document = await generateAgentDocument({ ...request, format: 'docx', message: 'Create a Word profile' });
    expect(document.sections[0].paragraphs[0]).toBe('AI training and systems');
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
  });

  it('retries a truncated OpenRouter HTTP JSON body without exposing a parser error', async () => {
    mocks.generateText
      .mockRejectedValueOnce(new SyntaxError("Expected ',' or ']' after array element in JSON"))
      .mockResolvedValueOnce(JSON.stringify({ title: 'Draft', sections: [{ heading: 'About', paragraphs: ['Useful content'] }] }));
    const document = await generateAgentDocument({ ...request, format: 'docx', message: 'Create a Word profile' });
    expect(document.sections[0].paragraphs).toEqual(['Useful content']);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
  });

  it('returns a readable Excel draft when both model replies are malformed', async () => {
    mocks.generateText.mockResolvedValue('{"title":"Broken","sheets":[{"rows":[');
    const document = await generateAgentDocument({ ...request, message: 'Create a 7 day Excel content plan' });
    expect(document.title).toMatch(/Draft/);
    expect(document.sheets[0].rows).toHaveLength(7);
    expect(document.sheets[0].rows[0][3]).toContain('DGACADEMY');
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    const bytes = new Uint8Array(await createAgentDocumentBlob(document).arrayBuffer());
    const sheets = await readXlsxFile(Buffer.from(bytes));
    expect(sheets[0].data).toHaveLength(8);
  });

  it('does not mask provider errors with a draft plan', async () => {
    mocks.generateText.mockRejectedValue(new Error('OpenRouter account is unavailable.'));
    await expect(generateAgentDocument({ ...request, message: 'Create a 7 day Excel content plan' })).rejects.toThrow('OpenRouter account is unavailable.');
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
});
