import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateText, update, remove, create, transactionGet, runTransaction } = vi.hoisted(() => ({
  generateText: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  transactionGet: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('../../api/_openrouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateOpenRouterText: generateText,
}));
vi.mock('../../api/_firebaseAdmin.js', () => {
  const db = {
    collection: () => ({ doc: (id) => ({ id: id || 'generated-1' }) }),
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
  runTransaction.mockImplementation(async (callback) => callback({ get: transactionGet, update, delete: remove, create }));
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

  it('adds and removes only the explicitly requested rows', async () => {
    generateText.mockResolvedValueOnce(JSON.stringify([
      { op: 'remove', index: 1 },
      { op: 'add', item: { date: '2026-10-06', type: 'image', topic: 'New campaign', prompt: 'New campaign photo', aspectRatio: '3:4' } },
    ]));
    const res = response();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer signed-in-token' },
      body: {
        action: 'editContentPlan',
        target: 'saved',
        message: 'Remove day 1 and add a new post to the content plan for October 6',
        items: [{ id: 'plan-1', date: '2026-10-05', type: 'image', topic: 'Old campaign', prompt: 'Old photo', status: 'PENDING' }],
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.removals).toEqual([1]);
    expect(res.body.additions[0]).toMatchObject({ id: 'generated-1', topic: 'New campaign', status: 'PENDING' });
    expect(remove).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'owner-1', topic: 'New campaign', aspectRatio: '3:4' }));
    expect(update).not.toHaveBeenCalled();
  });

  it('edits the plan from a pronoun-based command with no prior assistant turn about it', async () => {
    generateText.mockResolvedValueOnce(JSON.stringify([{
      op: 'update', index: 1,
      changes: { type: 'video', prompt: 'A presenter demonstrates the campaign', voiceOverText: 'សូមមកស្គាល់យុទ្ធនាការថ្មីរបស់យើង ដែលជួយអតិថិជនបានកាន់តែងាយស្រួល។' },
    }]));
    const res = response();
    await handler({
      method: 'POST', headers: {},
      body: {
        action: 'editContentPlan', target: 'draft', message: 'Change it to a video',
        items: [{ date: '2026-10-05', type: 'image', topic: 'Old campaign', prompt: 'Old photo', status: 'DRAFT' }],
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.patches[0].changes.type).toBe('video');
  });

  it('uses the previous plan conversation for a short follow-up edit', async () => {
    generateText.mockResolvedValueOnce(JSON.stringify([{
      op: 'update', index: 1,
      changes: { type: 'video', prompt: 'A presenter demonstrates the campaign', voiceOverText: 'សូមមកស្គាល់យុទ្ធនាការថ្មីរបស់យើង ដែលជួយអតិថិជនបានកាន់តែងាយស្រួល។' },
    }]));
    const res = response();
    await handler({
      method: 'POST', headers: {},
      body: {
        action: 'editContentPlan', target: 'draft', message: 'Change it to a video',
        planContext: [{ role: 'assistant', content: 'Content Plan: edited 1 in the draft.' }],
        items: [{ date: '2026-10-05', type: 'image', topic: 'Old campaign', prompt: 'Old photo', status: 'DRAFT' }],
      },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.patches[0].changes.type).toBe('video');
    expect(runTransaction).not.toHaveBeenCalled();
  });
});
