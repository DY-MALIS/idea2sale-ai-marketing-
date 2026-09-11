import { describe, expect, it } from 'vitest';
import { ensureBusinessInInboxMessage, googleSheetsUrlToCsvExportUrl } from '../../api/ai.js';

// Regression coverage for the Content Plan feature (AIAgent.tsx's plan-upload
// UI + extractContentPlan action): a user pastes a Google Sheets link, and
// this is the piece that decides whether it's actually a Sheets link at all
// and, if so, builds the CSV export URL the server then fetches.
describe('googleSheetsUrlToCsvExportUrl', () => {
  it('converts a plain Google Sheets edit URL to its CSV export URL', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit';
    expect(googleSheetsUrlToCsvExportUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv',
    );
  });

  it('preserves a specific tab (gid) so the plan on that tab is what gets read', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=987654321';
    expect(googleSheetsUrlToCsvExportUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=987654321',
    );
  });

  it('handles a gid passed as a query parameter instead of a hash fragment', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit?gid=42';
    expect(googleSheetsUrlToCsvExportUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=42',
    );
  });

  it('returns null for a URL that is not a Google Sheets link', () => {
    expect(googleSheetsUrlToCsvExportUrl('https://example.com/my-plan.pdf')).toBeNull();
    expect(googleSheetsUrlToCsvExportUrl('')).toBeNull();
    expect(googleSheetsUrlToCsvExportUrl(undefined)).toBeNull();
  });
});

describe('ensureBusinessInInboxMessage', () => {
  it('introduces the saved business in every Khmer outreach message', () => {
    const result = ensureBusinessInInboxMessage('សួស្តីបង ខ្ញុំឃើញថាហាងមានឱកាសធ្វើវីដេអូខ្លី។', 'DGACADEMY');
    expect(result).toContain('ខ្ញុំមកពី DGACADEMY។');
    expect(result).toContain('ឱកាសធ្វើវីដេអូខ្លី');
  });

  it('does not duplicate a business name already present', () => {
    const message = 'សួស្តី! ខ្ញុំមកពី DGACADEMY។ យើងចង់សហការជាមួយអ្នក។';
    expect(ensureBusinessInInboxMessage(message, 'DGACADEMY')).toBe(message);
  });
});
