import type { FacebookScanResult } from '../types';

export const normalizeFacebookScanHistoryResult = (
  raw: Partial<FacebookScanResult> | undefined,
): FacebookScanResult | null => {
  if (!raw || typeof raw !== 'object') return null;
  const insights = raw.customerInsights || ({} as Partial<FacebookScanResult['customerInsights']>);
  const hasValidActivityWindow = !!raw.activityWindow
    && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.activityWindow.startDate || ''))
    && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.activityWindow.endDate || ''));

  return {
    success: true,
    query: typeof raw.query === 'string' ? raw.query : '',
    scanMode: raw.scanMode,
    researchTarget: typeof raw.researchTarget === 'string' ? raw.researchTarget : undefined,
    webBusinessesFound: typeof raw.webBusinessesFound === 'number' ? raw.webBusinessesFound : undefined,
    webSearchAvailable: typeof raw.webSearchAvailable === 'boolean' ? raw.webSearchAvailable : undefined,
    activityWindow: hasValidActivityWindow ? raw.activityWindow : undefined,
    customerInsights: {
      whatTheyBought: Array.isArray(insights.whatTheyBought) ? insights.whatTheyBought : [],
      whatTheyLike: Array.isArray(insights.whatTheyLike) ? insights.whatTheyLike : [],
      contentDesires: Array.isArray(insights.contentDesires) ? insights.contentDesires : [],
      targetPersonas: Array.isArray(insights.targetPersonas) ? insights.targetPersonas : [],
    },
    competitors: Array.isArray(raw.competitors) ? raw.competitors : [],
    marketTrends: Array.isArray(raw.marketTrends) ? raw.marketTrends : [],
    potentialLeads: Array.isArray(raw.potentialLeads) ? raw.potentialLeads : [],
    videoPlan: Array.isArray(raw.videoPlan) ? raw.videoPlan : [],
    summaryReport: typeof raw.summaryReport === 'string' ? raw.summaryReport : '',
  };
};
