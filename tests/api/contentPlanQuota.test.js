import { describe, expect, it } from 'vitest';
import { contentPlanDay, selectDuePlanItems } from '../../api/_contentPlanQuota.js';

const doc = (id, userId, time) => ({
  id,
  data: () => ({ userId, ...(time ? { completedAt: { toDate: () => new Date(time) } } : {}) }),
});

describe('Content Plan daily quota', () => {
  it('uses the Bangkok date at the UTC day boundary', () => {
    expect(contentPlanDay(new Date('2026-11-08T17:30:00Z'))).toBe('2026-11-09');
  });

  it("does not let other accounts consume the owner's daily image quota", () => {
    const generated = [doc('other-1', 'other', '2026-11-09T02:41:00Z'), doc('other-2', 'other', '2026-11-09T02:42:00Z')];
    const due = [doc('owner-plan', 'owner'), doc('other-plan', 'other')];
    expect(selectDuePlanItems(due, generated, 2, '2026-11-09').map((item) => item.id)).toEqual(['owner-plan']);
  });

  it('reserves slots among pending items from the same account', () => {
    const due = [doc('first', 'owner'), doc('second', 'owner'), doc('third', 'owner')];
    expect(selectDuePlanItems(due, [], 2, '2026-11-09').map((item) => item.id)).toEqual(['first', 'second']);
  });
});
