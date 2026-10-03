import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentDocumentCard } from '../../src/components/AgentDocumentCard';

describe('AgentDocumentCard', () => {
  it('shows the complete monthly plan and a download control', () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`Day ${index + 1}`, `Idea ${index + 1}`]);
    const html = renderToStaticMarkup(
      <AgentDocumentCard
        document={{ format: 'xlsx', title: 'Monthly plan', sheets: [{ name: 'Plan', columns: ['Day', 'Idea'], rows }] }}
        language="en"
        onDownload={() => {}}
      />,
    );
    expect(html).toContain('Monthly plan');
    expect(html).toContain('Idea 30');
    expect(html).toContain('Download document');
  });
});
