import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateText, update, transactionGet, runTransaction } = vi.hoisted(() => ({
  generateText: vi.fn(),
  update: vi.fn(),
  transactionGet: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('../../api/_openrouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateOpenRouterText: generateText,
}));
vi.mock('../../api/_firebaseAdmin.js', () => {
  const ref = { id: 'plan-1' };
  const db = {
    collection: () => ({ doc: () => ref }),
    runTransaction,
  };
  return {
    initFirebaseAdmin: () => db,
    default: { auth: () => ({ verifyIdToken: async () => ({ uid: 'owner-1' }) }) },
  };
});
vi.mock('../../api/_rateLimit.js', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  getClientIp: () => '127.0.0.1',
}));

const { default: handler } = await import('../../api/ai.js');

const response = () => ({
  statusCode: 200,
  body: null,
  setHeader() {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

beforeEach(() => {
  vi.clearAllMocks();
  generateText.mockResolvedValue(JSON.stringify([{
    index: 1,
    changes: { topic: 'Updated campaign', prompt: 'Updated campaign photo' },
  }]));
  transactionGet.mockResolvedValue({
    exists: true,
    data: () => ({ userId: 'owner-1', status: 'PENDING', type: 'image' }),
    ref: { id: 'plan-1' },
  });
  runTransaction.mockImplementation(async (callback) => callback({ get: transactionGet, update }));
});

describe('editContentPlan', () => {
  it('saves the edited row before reporting success', async () => {
    const res = response();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer signed-in-token' },
      body: {
        action: 'editContentPlan',
        target: 'saved',
        message: 'Update content plan day 1 to the new campaign',
        items: [{ id: 'plan-1', date: '2026-10-05', type: 'image', topic: 'Old campaign', prompt: 'Old photo', status: 'PENDING' }],
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.anything(), { topic: 'Updated campaign', prompt: 'Updated campaign photo' });
  });

  it('refuses to report success when the row is no longer pending', async () => {
    transactionGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userId: 'owner-1', status: 'DONE', type: 'image' }),
      ref: { id: 'plan-1' },
    });
    const res = response();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer signed-in-token' },
      body: {
        action: 'editContentPlan',
        target: 'saved',
        message: 'Update content plan day 1 to the new campaign',
        items: [{ id: 'plan-1', date: '2026-10-05', type: 'image', topic: 'Old campaign', prompt: 'Old photo', status: 'PENDING' }],
      },
    }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain('Refresh');
    expect(update).not.toHaveBeenCalled();
  });
});
