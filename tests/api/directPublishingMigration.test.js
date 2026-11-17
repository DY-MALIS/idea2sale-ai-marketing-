import { describe, expect, it } from 'vitest';
import { releaseApprovalHeldPosts } from '../../api/_directPublishingMigration.js';

const fakeDb = (posts) => {
  const rows = new Map(Object.entries(posts));
  return {
    rows,
    collection() {
      return {
        where(field, operator, value) {
          expect(field).toBe('approvalStatus');
          expect(operator).toBe('==');
          return { get: async () => ({ docs: [...rows]
            .filter(([, post]) => post.approvalStatus === value)
            .map(([id, post]) => ({ ref: { id }, data: () => post })) }) };
        },
      };
    },
    runTransaction: async (fn) => fn({
      get: async (ref) => ({ data: () => rows.get(ref.id) }),
      update: (ref, patch) => rows.set(ref.id, { ...rows.get(ref.id), ...patch }),
    }),
  };
};

describe('retired Telegram approval holds', () => {
  it('releases future posts and leaves overdue posts for rescheduling', async () => {
    const now = Date.parse('2026-11-17T10:00:00Z');
    const db = fakeDb({
      future: { status: 'AWAITING_APPROVAL', approvalRequired: true, approvalStatus: 'AWAITING_LINK', scheduledTime: '2026-11-18T10:00:00Z' },
      overdue: { status: 'PENDING', approvalRequired: true, approvalStatus: 'AWAITING_DUE', scheduledTime: '2026-11-16T10:00:00Z' },
      published: { status: 'PUBLISHED', approvalRequired: true, approvalStatus: 'REQUESTED', scheduledTime: '2026-11-16T10:00:00Z' },
    });
    expect(await releaseApprovalHeldPosts(db, now)).toEqual({ released: 1, overdue: 1 });
    expect(db.rows.get('future')).toMatchObject({ status: 'PENDING', approvalRequired: false, approvalStatus: 'BYPASSED' });
    expect(db.rows.get('overdue')).toMatchObject({ status: 'FAILED', approvalRequired: false, approvalStatus: 'BYPASSED' });
    expect(db.rows.get('published')).toMatchObject({ status: 'PUBLISHED', approvalRequired: true });
  });
});
