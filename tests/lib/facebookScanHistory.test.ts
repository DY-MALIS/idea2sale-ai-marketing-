import { expect, it } from 'vitest';
import { normalizeFacebookScanHistoryResult } from '../../src/lib/facebookScanHistory';

it('preserves live-search and activity metadata when restoring scan history', () => {
  const restored = normalizeFacebookScanHistoryResult({
    success: true,
    query: 'training competitors',
    scanMode: 'competitor_activity',
    webBusinessesFound: 12,
    webSearchAvailable: true,
    activityWindow: { startDate: '2026-09-10', endDate: '2026-09-16' },
    customerInsights: {
      whatTheyBought: [],
      whatTheyLike: [],
      contentDesires: [],
      targetPersonas: [],
    },
    competitors: [],
    potentialLeads: [],
    videoPlan: [],
    summaryReport: '',
  });

  expect(restored).toMatchObject({
    webBusinessesFound: 12,
    webSearchAvailable: true,
    activityWindow: { startDate: '2026-09-10', endDate: '2026-09-16' },
  });
});

it('drops malformed activity metadata while normalizing missing arrays', () => {
  const restored = normalizeFacebookScanHistoryResult({
    activityWindow: { startDate: 'not-a-date', endDate: '2026-09-16' },
  });

  expect(restored?.activityWindow).toBeUndefined();
  expect(restored?.competitors).toEqual([]);
  expect(restored?.potentialLeads).toEqual([]);
});
