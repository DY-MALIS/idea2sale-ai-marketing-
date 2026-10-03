import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentDocumentCard, AgentDocumentDialog } from '../../src/components/AgentDocumentCard';

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

  it('shows a centered document dialog with a manual download button', () => {
    const html = renderToStaticMarkup(
      <AgentDocumentDialog
        document={{ format: 'docx', title: 'Plan for October', sections: [{ heading: 'Week 1', paragraphs: ['Post daily'] }] }}
        language="en"
        onDownload={() => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Document ready');
    expect(html).toContain('Plan for October');
    expect(html).toContain('Download document');
  });
});
