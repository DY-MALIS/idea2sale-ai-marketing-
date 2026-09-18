import { describe, expect, it } from 'vitest';
import {
  ensureBusinessInInboxMessage,
  FACEBOOK_SCAN_MODES,
  getFacebookCompetitorActivityWindow,
  getAiRateLimitPolicy,
  getVideoCaptionSpec,
  googleSheetsUrlToCsvExportUrl,
  resolveCreativeImageMode,
  resolveCompetitorResearchTarget,
  resolveFacebookScanMode,
  resolveVideoAspectRatio,
} from '../../api/ai.js';

describe('getVideoCaptionSpec', () => {
  it('creates a standard YouTube post with title and searchable description guidance', () => {
    const spec = getVideoCaptionSpec('YouTube');
    expect(spec.platform).toBe('YouTube');
    expect(spec.instruction).toContain('maximum 100 characters');
    expect(spec.instruction).toContain('searchable description');
  });

  it('falls back to TikTok for unknown client values', () => {
    expect(getVideoCaptionSpec('youtube')).toMatchObject({ platform: 'TikTok' });
  });
});

describe('resolveVideoAspectRatio', () => {
  it('keeps standard YouTube video horizontal while social short video stays portrait', () => {
    expect(resolveVideoAspectRatio('16:9')).toBe('16:9');
    expect(resolveVideoAspectRatio('9:16')).toBe('16:9');
    expect(resolveVideoAspectRatio('4:3')).toBe('16:9');
  });
});

describe('video rate-limit policy', () => {
  it('keeps paid generation and polling out of the shared AI quota', () => {
    expect(getAiRateLimitPolicy('videoGenerate')).toMatchObject({
      scope: 'video-generate',
      ipScope: 'video-generate-ip',
      failClosed: true,
    });
    expect(getAiRateLimitPolicy('videoStatus')).toMatchObject({ scope: 'video-status', failClosed: false });
    expect(getAiRateLimitPolicy('copyGenerate')).toMatchObject({ scope: 'ai' });
    expect(getAiRateLimitPolicy('videoStatus').limit).toBeGreaterThan(80);
  });
});

describe('resolveCreativeImageMode', () => {
  it('preserves explicit poster requests through image automation', () => {
    expect(resolveCreativeImageMode('image', 'poster', 'create an image')).toBe('poster');
    expect(resolveCreativeImageMode('image', 'visual', 'ធ្វើជាទម្រង់ poster')).toBe('poster');
    expect(resolveCreativeImageMode('image', 'visual', 'create a normal product photo')).toBe('visual');
    expect(resolveCreativeImageMode('video', 'poster', 'poster')).toBe('visual');
  });
});

describe('resolveFacebookScanMode', () => {
  it('accepts the complete supported scanner target list', () => {
    const expectedModes = [
      'customer',
      'ai_interest',
      'market_trends',
      'high_value',
      'construction',
      'workers',
      'competitor_activity',
      'competitor_customers',
      'hiring',
    ];
    expect(FACEBOOK_SCAN_MODES).toEqual(expectedModes);
    for (const mode of expectedModes) {
      expect(resolveFacebookScanMode(mode)).toBe(mode);
    }
  });

  it('falls back safely when a client submits an unknown mode', () => {
    expect(resolveFacebookScanMode('private_profiles')).toBe('customer');
    expect(resolveFacebookScanMode(undefined)).toBe('customer');
  });
});

describe('resolveCompetitorResearchTarget', () => {
  it('uses the Business Profile when the query is only a generic competitor-activity instruction', () => {
    expect(resolveCompetitorResearchTarget(
      'ស្វែងរកសកម្មភាពរបស់គូប្រកួតក្នុង ១ អាទិត្យ',
      'DGACADEMY',
    )).toBe('DGACADEMY');
    expect(resolveCompetitorResearchTarget(
      'find competitor activity from this week',
      'DGACADEMY',
    )).toBe('DGACADEMY');
  });

  it('preserves an explicit competitor or niche target', () => {
    expect(resolveCompetitorResearchTarget('skincare competitors Cambodia', 'DGACADEMY')).toBe('skincare competitors Cambodia');
    expect(resolveCompetitorResearchTarget('DGACADEMY competitors', 'DGACADEMY')).toBe('DGACADEMY competitors');
  });
});

describe('getFacebookCompetitorActivityWindow', () => {
  it('returns exactly 7 calendar days ending on today in Cambodia time', () => {
    expect(getFacebookCompetitorActivityWindow(new Date('2026-09-13T18:30:00.000Z'))).toEqual({
      startDate: '2026-09-08',
      endDate: '2026-09-14',
    });
  });

  it('uses the selected market timezone instead of always using Cambodia time', () => {
    expect(getFacebookCompetitorActivityWindow(
      new Date('2026-09-14T03:30:00.000Z'),
      'America/New_York',
    )).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
    });
  });
});

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
