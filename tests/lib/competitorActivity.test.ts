import { expect, it } from 'vitest';
import { FacebookScanResult } from '../../src/types';
import { competitorActivityKey, summarizeCompetitorActivities } from '../../src/lib/competitorActivity';

const scan = (activities: Array<{ date: string; activity: string; sourceUrl: string }>): FacebookScanResult => ({
  success: true,
  query: 'coffee competitors',
  scanMode: 'competitor_activity',
  activityWindow: { startDate: '2026-09-12', endDate: '2026-09-18' },
  customerInsights: { whatTheyBought: [], whatTheyLike: [], contentDesires: [], targetPersonas: [] },
  competitors: [{
    pageName: 'Rival Coffee',
    topAngle: '',
    offerStrategy: '',
    weakness: '',
    counterStrategy: '',
    recentActivities: activities,
  }],
  potentialLeads: [],
  videoPlan: [],
  summaryReport: '',
});

it('counts only activities not present in the previous weekly capture as new', () => {
  const shared = { date: '2026-09-15', activity: 'Posted a coffee bundle.', sourceUrl: 'https://example.com/shared' };
  const added = { date: '2026-09-18', activity: 'Launched a weekend discount.', sourceUrl: 'https://example.com/new' };
  const summary = summarizeCompetitorActivities(scan([shared, added]), scan([shared]));

  expect(summary).toMatchObject({ totalCount: 2, newCount: 1, hasPreviousCapture: true });
  expect(summary.newActivityKeys.has(competitorActivityKey('Rival Coffee', added))).toBe(true);
  expect(summary.newActivityKeys.has(competitorActivityKey('Rival Coffee', shared))).toBe(false);
});

it('marks the first scan as a first capture while retaining its captured count', () => {
  const summary = summarizeCompetitorActivities(scan([{
    date: '2026-09-18',
    activity: 'Published a new campaign.',
    sourceUrl: 'https://example.com/campaign',
  }]), null);

  expect(summary).toMatchObject({ totalCount: 1, newCount: 1, hasPreviousCapture: false });
});
