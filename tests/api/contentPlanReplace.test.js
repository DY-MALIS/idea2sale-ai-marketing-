import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), db: null }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock('../../api/_firebaseAdmin.js', () => ({ initFirebaseAdmin: () => mocks.db }));
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
  });

  it('atomically removes all old plan items before the new plan becomes visible', async () => {
    const deleted = [];
    const creates = [];
    const oldDocs = ['PENDING', 'PROCESSING', 'DONE'].map((status, i) => ({
      ref: { id: `old-${i}` }, data: () => ({ status, userId: 'owner-1' }),
    }));
    let nextId = 0;
    const collection = {
      doc: () => ({ id: `new-${++nextId}` }),
      where: () => ({ kind: 'owner-query' }),
    };
    mocks.db = {
      collection: () => collection,
      runTransaction: async (callback) => callback({
        get: async () => ({ docs: oldDocs }),
        delete: (ref) => deleted.push(ref),
        create: (ref, fields) => creates.push({ ref, fields }),
      }),
    };
    const res = response();
    await handler({
      method: 'POST', headers: { authorization: 'Bearer token' },
      body: { items: [{ scheduledDate: '2026-10-29', type: 'image', topic: 'New', prompt: 'New image' }] },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ savedCount: 1, replacedCount: 3 });
    expect(deleted.map((ref) => ref.id)).toEqual(['old-0', 'old-1', 'old-2']);
    expect(creates[0].fields).toMatchObject({ userId: 'owner-1', status: 'PENDING', topic: 'New' });
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
});
