import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), botCall: vi.fn(), entitlement: vi.fn() }));
vi.mock('../../api/_contentPlanTiming.js', async (importOriginal) => ({
  ...await importOriginal(), scheduleContentPlanStart: mocks.schedule,
}));
vi.mock('../../api/_telegramApproval.js', () => ({ botCall: mocks.botCall }));
vi.mock('../../api/_contentPlanEntitlements.js', () => ({
  hasUnlimitedContentPlanGeneration: mocks.entitlement,
}));
const { claimScheduledPlanItem } = await import('../../api/_contentPlanClaim.js');

const makeDb = (items) => {
  const records = new Map();
  for (const [id, value] of Object.entries(items)) records.set(`content_plan_items/${id}`, { ...value });
  records.set('telegram_approval_links/owner', { chatId: 123, telegramUserId: 123, botOwnerId: 'owner' });
  records.set('business_profiles/owner', { telegramBotToken: 'token', telegramBotActive: true });
  const ref = (collection, id) => ({
    id, path: `${collection}/${id}`,
    async get() { return snap(this); },
    async update(fields) { records.set(this.path, { ...records.get(this.path), ...fields }); },
  });
  const snap = (document) => ({ id: document.id, ref: document, exists: records.has(document.path), data: () => records.get(document.path) });
  const db = {
    collection(name) { return {
      doc(id) { return ref(name, id); },
      where(field, op, value) { return { name, field, value }; },
    }; },
    async runTransaction(callback) {
      return callback({
        async get(target) {
          if (target.path) return snap(target);
          return { docs: [...records.keys()].filter((key) => key.startsWith(`${target.name}/`))
            .map((key) => ref(target.name, key.slice(target.name.length + 1)))
            .filter((document) => records.get(document.path)?.[target.field] === target.value)
            .map(snap) };
        },
        update(document, fields) { records.set(document.path, { ...records.get(document.path), ...fields }); },
        set(document, fields) { records.set(document.path, fields); },
      });
    },
  };
  return { db, records, ref: (id) => db.collection('content_plan_items').doc(id) };
};

const due = '2026-11-09T06:00:00.000Z';
const start = '2026-11-09T05:55:00.000Z';
const baseItem = (type = 'image') => ({
  userId: 'owner', type, status: 'PENDING', topic: 'Post', scheduledAt: due,
  approvalDueAt: due, nextGenerationAt: start,
});

describe('Content Plan generation claim', () => {
  beforeEach(() => {
    mocks.schedule.mockReset().mockResolvedValue({ messageId: 'queued' });
    mocks.botCall.mockReset().mockResolvedValue({ message_id: 1 });
    mocks.entitlement.mockReset().mockResolvedValue(false);
  });

  it('claims one item once across duplicate trigger and cron calls', async () => {
    const { db, ref, records } = makeDb({ first: baseItem() });
    const now = Date.parse(start);
    expect((await claimScheduledPlanItem(db, ref('first'), now)).post.id).toBe('first');
    expect(await claimScheduledPlanItem(db, ref('first'), now)).toEqual({ skipped: 'inactive' });
    expect(records.get('content_plan_generation_quotas/owner_2026-11-09_image').itemIds).toEqual(['first']);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('defers a third image, queues tomorrow and sends one private notice', async () => {
    const { db, ref, records } = makeDb({
      first: { ...baseItem(), status: 'DONE', generationQuotaDay: '2026-11-09' },
      second: { ...baseItem(), status: 'PROCESSING', generationQuotaDay: '2026-11-09' },
      third: baseItem(),
    });
    const now = Date.parse(start);
    const result = await claimScheduledPlanItem(db, ref('third'), now);
    expect(result.deferred).toBe(true);
    expect(records.get('content_plan_items/third')).toMatchObject({
      status: 'PENDING', approvalDueAt: '2026-11-10T06:00:00.000Z',
      nextGenerationAt: '2026-11-10T05:55:00.000Z', quotaNoticeStatus: 'SENT',
    });
    expect(mocks.schedule).toHaveBeenCalledWith('third', '2026-11-10T05:55:00.000Z', db);
    expect(mocks.botCall).toHaveBeenCalledTimes(1);
    expect(await claimScheduledPlanItem(db, ref('third'), now)).toEqual({ skipped: 'early' });
    expect(mocks.botCall).toHaveBeenCalledTimes(1);
    records.set('content_plan_generation_quotas/owner_2026-11-09_image', { itemIds: ['first', 'second'] });
    expect((await claimScheduledPlanItem(db, ref('third'), Date.parse('2026-11-10T05:55:00Z'))).post.id).toBe('third');
  });

  it('limits video generation to one per Bangkok day', async () => {
    const { db, ref } = makeDb({
      first: { ...baseItem('video'), status: 'PROCESSING', generationQuotaDay: '2026-11-09' },
      second: { ...baseItem('video'), nextGenerationAt: '2026-11-09T05:45:00.000Z' },
    });
    expect((await claimScheduledPlanItem(db, ref('second'), Date.parse('2026-11-09T05:45:00Z'))).deferred).toBe(true);
  });

  it.each(['image', 'video'])('lets the entitled account claim multiple %s items without quota deferral', async (type) => {
    mocks.entitlement.mockResolvedValue(true);
    const { db, ref, records } = makeDb({
      first: { ...baseItem(type), status: 'DONE', generationQuotaDay: '2026-11-09' },
      second: { ...baseItem(type), status: 'DONE', generationQuotaDay: '2026-11-09' },
      third: baseItem(type),
      fourth: baseItem(type),
    });
    const now = Date.parse(start);
    expect((await claimScheduledPlanItem(db, ref('third'), now)).post.id).toBe('third');
    expect((await claimScheduledPlanItem(db, ref('fourth'), now)).post.id).toBe('fourth');
    expect(await claimScheduledPlanItem(db, ref('third'), now)).toEqual({ skipped: 'inactive' });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.botCall).not.toHaveBeenCalled();
    expect(records.has(`content_plan_generation_quotas/owner_2026-11-09_${type}`)).toBe(false);
  });
});
