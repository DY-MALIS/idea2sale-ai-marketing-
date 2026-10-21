import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../../api/_firebaseAdmin.js', () => ({
  default: { auth: () => ({ verifyIdToken: mocks.verifyIdToken }) },
  initFirebaseAdmin: () => ({ collection: () => ({
    doc: () => ({ get: mocks.get, create: mocks.create, set: mocks.set, delete: mocks.delete }),
    where: () => ({ limit: () => ({ get: mocks.get }) }),
  }) }),
}));
vi.mock('../../api/_imagekitUpload.js', () => ({
  getImageKitConfig: () => ({ privateKey: 'test-private', urlEndpoint: 'https://ik.imagekit.io/test' }),
  createImageKitUploadAuth: () => ({ token: 'test', signature: 'signature', expire: 123, uploadUrl: 'https://upload.imagekit.io/api/v1/files/upload' }),
}));
import handler from '../../api/_profileFiles.js';

const makeResponse = () => ({
  statusCode: 200,
  setHeader: vi.fn(),
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; },
});
const request = (action, fileId = 'file_12345678') => ({ method: 'POST', headers: { authorization: 'Bearer test-token' }, query: { action }, body: { fileId, name: 'brochure.pdf' } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verifyIdToken.mockResolvedValue({ uid: 'company_a' });
  mocks.get.mockResolvedValue({ exists: false });
  mocks.create.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn());
});

it('rejects a private file uploaded under a different company', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ filePath: '/business-profile-files/company_b/brochure.pdf', isPrivateFile: true, size: 100 }) });
  const res = makeResponse();
  await handler(request('finalize'), res);
  expect(res.statusCode).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});

it('rejects public files even in the owner folder', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ filePath: '/business-profile-files/company_a/brochure.pdf', isPrivateFile: false, size: 100 }) });
  const res = makeResponse();
  await handler(request('finalize'), res);
  expect(res.statusCode).toBe(403);
  expect(mocks.create).not.toHaveBeenCalled();
});

it('stores a verified private file for the signed-in company', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ filePath: '/business-profile-files/company_a/brochure.pdf', isPrivateFile: true, size: 100 }) });
  const res = makeResponse();
  await handler(request('finalize'), res);
  expect(res.statusCode).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'company_a', filePath: '/business-profile-files/company_a/brochure.pdf' }));
});

it('does not issue a download URL for another company file', async () => {
  mocks.get.mockResolvedValue({ exists: true, data: () => ({ ownerId: 'company_b', filePath: '/business-profile-files/company_b/brochure.pdf' }) });
  const res = makeResponse();
  await handler({ ...request('download'), method: 'GET' }, res);
  expect(res.statusCode).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
