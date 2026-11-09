import { describe, expect, it } from 'vitest';
import { contentPlanLeadMs, contentPlanTiming, nextContentPlanQuotaTiming } from '../../api/_contentPlanTiming.js';

describe('Content Plan timing', () => {
  it('starts images five minutes early and videos fifteen minutes early', () => {
    const due = '2026-11-09T06:00:00.000Z';
    expect(contentPlanLeadMs('image')).toBe(5 * 60_000);
    expect(contentPlanLeadMs('video')).toBe(15 * 60_000);
    expect(contentPlanTiming(due, 'image', Date.parse('2026-11-09T05:00:00Z'))).toEqual({
      approvalDueAt: due, nextGenerationAt: '2026-11-09T05:55:00.000Z',
    });
    expect(contentPlanTiming(due, 'video', Date.parse('2026-11-09T05:00:00Z'))).toEqual({
      approvalDueAt: due, nextGenerationAt: '2026-11-09T05:45:00.000Z',
    });
  });

  it('starts a late import immediately while preserving its original approval time', () => {
    expect(contentPlanTiming('2026-11-09T06:49:00Z', 'image', Date.parse('2026-11-09T06:50:00Z'))).toEqual({
      approvalDueAt: '2026-11-09T06:49:00.000Z', nextGenerationAt: '2026-11-09T06:50:00.000Z',
    });
  });

  it('defers a quota-limited item to the same Bangkok clock time tomorrow', () => {
    expect(nextContentPlanQuotaTiming('2026-11-09T06:00:00Z', 'image', Date.parse('2026-11-09T05:55:00Z'))).toEqual({
      approvalDueAt: '2026-11-10T06:00:00.000Z', nextGenerationAt: '2026-11-10T05:55:00.000Z',
    });
    expect(nextContentPlanQuotaTiming('2026-11-09T06:00:00Z', 'video', Date.parse('2026-11-10T05:50:00Z'))).toEqual({
      approvalDueAt: '2026-11-11T06:00:00.000Z', nextGenerationAt: '2026-11-11T05:45:00.000Z',
    });
  });
});
