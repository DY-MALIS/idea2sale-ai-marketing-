import { FacebookRecentActivity, FacebookScanResult } from '../types';

const normalize = (value: unknown) => String(value || '').trim().toLocaleLowerCase();

export const competitorActivityKey = (competitorName: string, activity: FacebookRecentActivity) => [
  normalize(competitorName),
  normalize(activity.date),
  normalize(activity.sourceUrl),
  normalize(activity.activity),
].join('|');

export interface CompetitorActivitySummary {
  totalCount: number;
  newCount: number;
  hasPreviousCapture: boolean;
  newActivityKeys: Set<string>;
}

export const summarizeCompetitorActivities = (
  current: FacebookScanResult | null,
  previous: FacebookScanResult | null,
): CompetitorActivitySummary => {
  const previousKeys = new Set((previous?.competitors || []).flatMap((competitor) => (
    (competitor.recentActivities || []).map((activity) => competitorActivityKey(competitor.pageName, activity))
  )));
  const currentKeys = (current?.competitors || []).flatMap((competitor) => (
    (competitor.recentActivities || []).map((activity) => competitorActivityKey(competitor.pageName, activity))
  ));
  const newActivityKeys = new Set(currentKeys.filter((key) => !previousKeys.has(key)));

  return {
    totalCount: currentKeys.length,
    newCount: newActivityKeys.size,
    hasPreviousCapture: !!previous,
    newActivityKeys,
  };
};
