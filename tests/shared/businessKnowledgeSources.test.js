import { describe, expect, it } from 'vitest';
import { knowledgeForSavedLinks } from '../../shared/businessKnowledgeSources.js';

describe('business knowledge when profile links change', () => {
  it('keeps knowledge only for the same saved links', () => {
    expect(knowledgeForSavedLinks('Current facts', ['https://example.com'], ['https://example.com']))
      .toEqual({ businessKnowledgeBase: 'Current facts', businessKnowledgeBaseSources: ['https://example.com'] });
  });

  it('clears stale facts when a link is replaced or removed', () => {
    expect(knowledgeForSavedLinks('Old facts', ['https://old.example'], ['https://new.example']).businessKnowledgeBase).toBe('');
    expect(knowledgeForSavedLinks('Old facts', ['https://old.example'], []).businessKnowledgeBaseSources).toEqual([]);
  });
});
