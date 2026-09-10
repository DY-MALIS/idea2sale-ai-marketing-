import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), init: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock('../../../api/_firebaseAdmin.js', () => ({ initFirebaseAdmin: mocks.init }));
import handler from '../../../api/telegram/review-video.js';
afterEach(() => vi.resetAllMocks());
const response = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
function setup(item) {
  const tx = { get: vi.fn(async () => ({ data: () => item })), set: vi.fn(), update: vi.fn() };
  mocks.verify.mockResolvedValue({ uid: 'owner' });
  mocks.init.mockReturnValue({ collection: name => ({ doc: id => ({ name, id }) }), runTransaction: fn => fn(tx) });
  return tx;
}
const request = (body = {}) => ({ method: 'POST', headers: { authorization: 'Bearer token' }, body: { itemId: 'abcdefghijk', action: 'approve', mediaUrl: 'https://video', ...body } });
it('requires authentication', async () => {
  const res = response(); await handler({ method: 'POST', headers: {} }, res);
  expect(res.statusCode).toBe(401); expect(mocks.init).not.toHaveBeenCalled();
});
it.each([
  { userId: 'other', status: 'REVIEW', speechVerification: { passed: true } },
  { userId: 'owner', status: 'FAILED', speechVerification: { passed: false } },
  { userId: 'owner', status: 'REVIEW', speechVerification: { passed: true }, resultMediaUrl: 'https://new-video' },
  { userId: 'owner', status: 'DONE', speechVerification: { passed: true } },
])('rejects foreign, failed, changed or already-approved videos', async item => {
  const tx = setup({ type: 'video', resultMediaUrl: 'https://video', ...item });
  const res = response(); await handler(request(), res);
  expect(res.statusCode).toBe(409); expect(tx.set).not.toHaveBeenCalled(); expect(tx.update).not.toHaveBeenCalled();
});
it('atomically queues only the reviewed video and records its reviewer', async () => {
  const tx = setup({ userId: 'owner', type: 'video', status: 'REVIEW', resultMediaUrl: 'https://video', speechVerification: { passed: true } });
  const res = response(); await handler(request(), res);
  expect(res.statusCode).toBe(200);
  expect(tx.set).toHaveBeenCalledWith({ name: 'scheduled_posts', id: 'review-abcdefghijk' }, expect.objectContaining({ mediaUrl: 'https://video', status: 'PENDING', userId: 'owner' }));
  expect(tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reviewedBy: 'owner', 'speechVerification.naturalnessReviewed': true }));
});
it('retries only an owned failed/review item and clears stale generation data', async () => {
  const tx = setup({ userId: 'owner', status: 'FAILED' });
  const res = response(); await handler(request({ action: 'retry' }), res);
  expect(res.statusCode).toBe(200); expect(tx.set).not.toHaveBeenCalled();
  expect(tx.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 'PENDING', videoJobId: null, narrationAudio: null }));
});
