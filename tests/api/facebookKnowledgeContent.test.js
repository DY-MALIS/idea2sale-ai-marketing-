import { describe, expect, it } from 'vitest';
import { facebookPageKnowledgeContent } from '../../api/_facebookKnowledge.js';

describe('Facebook Page content for the AI Agent', () => {
  it('includes connected Page posts using the Graph reader text field', () => {
    const content = facebookPageKnowledgeContent({ about: 'Training academy', posts: [{ text: 'New AI workshop on Friday' }] });
    expect(content).toContain('Training academy');
    expect(content).toContain('New AI workshop on Friday');
  });
});
