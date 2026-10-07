import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock('../../api/_openrouter.js', () => ({
  generateOpenRouterText: mocks.generateText,
  resolveOpenRouterTextModel: () => 'test/model',
}));

import { generateAgentDocument } from '../../api/_agentDocument.js';

const request = {
  format: 'xlsx',
  message: 'Create an Excel content plan for one month',
  historyText: '',
  businessContextText: 'Business name: DGACADEMY\nBusiness description: AI training and systems',
  responseLanguage: 'English',
};

describe('agent document generation', () => {
  beforeEach(() => { mocks.generateText.mockReset(); });

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
});
