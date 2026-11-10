import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: null, schedule: vi.fn(), cancel: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock('../../api/_firebaseAdmin.js', () => ({ initFirebaseAdmin: () => mocks.db }));
vi.mock('../../api/_contentPlanTiming.js', async (importOriginal) => ({
  ...await importOriginal(), scheduleContentPlanStart: mocks.schedule, cancelContentPlanStart: mocks.cancel,
}));
const { default: handler } = await import('../../api/_contentPlanReplace.js');

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

describe('replace content plan', () => {
  beforeEach(() => {
    mocks.verify.mockReset().mockResolvedValue({ uid: 'owner-1' });
    mocks.schedule.mockReset().mockResolvedValue({ messageId: 'queued' });
    mocks.cancel.mockReset().mockResolvedValue(undefined);
  });

  it('atomically removes all old plan items before the new plan becomes visible', async () => {
    const deleted = [];
    const updated = [];
    const creates = [];
    const oldDocs = ['PENDING', 'PROCESSING', 'DONE'].map((status, i) => ({
      ref: { id: `old-${i}` }, data: () => ({ status, userId: 'owner-1',
        ...(status === 'PENDING' ? { generationTriggerMessageId: 'old-qstash-trigger' } : {}),
      }),
    }));
    let nextId = 0;
    const collection = {
      doc: () => ({ id: `new-${++nextId}` }),
      where: () => ({ kind: 'owner-query' }),
    };
    mocks.db = {
      collection: (name) => name === 'scheduled_posts' ? { where: () => ({ kind: 'posts-query' }) } : collection,
      runTransaction: async (callback) => callback({
        get: async (query) => ({ docs: query.kind === 'posts-query' ? [] : oldDocs }),
        delete: (ref) => deleted.push(ref),
        update: (ref, fields) => updated.push({ ref, fields }),
        create: (ref, fields) => creates.push({ ref, fields }),
      }),
    };
    const res = response();
    await handler({
      method: 'POST', headers: { authorization: 'Bearer token' },
      body: { items: [{ scheduledDate: '2026-10-29', type: 'image', topic: 'New', prompt: 'New image' }] },
    }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ savedCount: 1, replacedCount: 3 });
    expect(deleted.map((ref) => ref.id)).toEqual(['old-0', 'old-2']);
    expect(updated).toMatchObject([{ ref: { id: 'old-1' }, fields: { status: 'DELETING' } }]);
    expect(creates[0].fields).toMatchObject({ userId: 'owner-1', status: 'PENDING', topic: 'New' });
    expect(creates[0].fields.approvalDueAt).toBe('2026-10-28T17:00:00.000Z');
    expect(mocks.schedule).toHaveBeenCalledWith('new-2', expect.any(String), mocks.db);
    expect(mocks.cancel).toHaveBeenCalledWith('old-qstash-trigger');
  });

  it('rejects invalid replacement before touching existing items', async () => {
    mocks.db = { collection: vi.fn() };
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {
      items: [{ scheduledDate: 'tomorrow', type: 'image', topic: 'New', prompt: 'New image' }],
    } }, res);
    expect(res.statusCode).toBe(400);
    expect(mocks.db.collection).not.toHaveBeenCalled();
  });

  it('saves a scheduled video without TikTok consent for Telegram approval', async () => {
    const created = [];
    mocks.db = {
      collection: (name) => ({ doc: () => ({ id: 'saved-video' }), where: () => ({ name }) }),
      runTransaction: async (callback) => callback({
        get: async () => ({ docs: [] }),
        create: (ref, fields) => created.push({ ref, fields }),
      }),
    };
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {
      items: [{ scheduledDate: '2026-11-10', scheduledTime: '13:00', scheduledAt: '2026-11-10T06:00:00.000Z', type: 'video',
        topic: 'Training', prompt: 'Presenter at a laptop', voiceOverText: 'សូមស្វាគមន៍' }],
    } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(created[0].fields).toMatchObject({ type: 'video', status: 'PENDING',
      approvalRequired: true, autoPublishDestinations: true, tiktokDirectPostConsent: false });
    expect(mocks.schedule).toHaveBeenCalledWith('saved-video', expect.any(String), mocks.db);
  });

  it('archives old items with unanswered approvals while replacing the visible plan', async () => {
    const deleted = [];
    const updated = [];
    const created = [];
    const oldDocs = ['pending-approval', 'finished'].map((id) => ({
      id, ref: { id }, data: () => ({ userId: 'owner-1', status: 'DONE' }),
    }));
    const pendingPosts = [{ data: () => ({
      userId: 'owner-1', sourcePlanItemId: 'pending-approval', status: 'AWAITING_APPROVAL',
      approvalRequired: true, approvalStatus: 'REQUESTED',
    }) }];
    mocks.db = {
      collection: (name) => ({ doc: () => ({ id: 'new-plan-item' }), where: () => ({ name }) }),
      runTransaction: async (callback) => callback({
        get: async (query) => ({ docs: query.name === 'scheduled_posts' ? pendingPosts : oldDocs }),
        delete: (ref) => deleted.push(ref.id),
        update: (ref, fields) => updated.push({ id: ref.id, fields }),
        create: (ref, fields) => created.push({ ref, fields }),
      }),
    };
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {
      items: [{ scheduledDate: '2026-11-08', type: 'image', topic: 'New', prompt: 'New image' }],
    } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(deleted).toEqual(['finished']);
    expect(updated).toEqual([{ id: 'pending-approval', fields: { archivedAt: expect.anything() } }]);
    expect(created).toHaveLength(1);
  });

  it('cancels unsent early media destinations and schedules cleanup', async () => {
    const updates = [];
    const source = { id: 'early', ref: { id: 'early' }, data: () => ({
      userId: 'owner-1', status: 'DONE', resultMediaUrl: 'https://cdn.example/early.jpg',
    }) };
    const destination = { id: 'plan-early-telegram', ref: { id: 'plan-early-telegram' }, data: () => ({
      userId: 'owner-1', sourcePlanItemId: 'early', status: 'PENDING',
      approvalRequired: true, approvalStatus: 'AWAITING_DUE',
    }) };
    let id = 0;
    mocks.db = {
      collection: (name) => ({ doc: () => ({ id: `new-${++id}` }), where: () => ({ name }) }),
      runTransaction: async (callback) => callback({
        get: async (query) => ({ docs: query.name === 'scheduled_posts' ? [destination] : [source] }),
        update: (ref, fields) => updates.push({ id: ref.id, fields }),
        create: vi.fn(), delete: vi.fn(),
      }),
    };
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {
      items: [{ scheduledDate: '2026-11-10', type: 'image', topic: 'New', prompt: 'New image' }],
    } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(updates).toMatchObject([
      { id: 'plan-early-telegram', fields: { status: 'CANCELLED', approvalStatus: 'REJECTED' } },
      { id: 'early', fields: { status: 'DELETING', supersededBy: 'new-1' } },
    ]);
  });

  it('keeps media for a post that was already published', async () => {
    const updates = [];
    const source = { id: 'published', ref: { id: 'published' }, data: () => ({
      userId: 'owner-1', status: 'DONE', resultMediaUrl: 'https://cdn.example/published.jpg',
    }) };
    const post = { data: () => ({ userId: 'owner-1', sourcePlanItemId: 'published',
      approvalRequired: true, approvalStatus: 'APPROVED', status: 'PUBLISHED',
    }) };
    mocks.db = {
      collection: (name) => ({ doc: () => ({ id: 'replacement' }), where: () => ({ name }) }),
      runTransaction: async (callback) => callback({
        get: async (query) => ({ docs: query.name === 'scheduled_posts' ? [post] : [source] }),
        update: (ref, fields) => updates.push({ id: ref.id, fields }),
        create: vi.fn(), delete: vi.fn(),
      }),
    };
    const res = response();
    await handler({ method: 'POST', headers: { authorization: 'Bearer token' }, body: {
      items: [{ scheduledDate: '2026-11-10', type: 'image', topic: 'New', prompt: 'New image' }],
    } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(updates).toEqual([{ id: 'published', fields: { archivedAt: expect.anything() } }]);
  });
});
