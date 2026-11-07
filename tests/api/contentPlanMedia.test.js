import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ r2Send: vi.fn() }));
vi.mock('../../api/_imagekitUpload.js', () => ({
  getImageKitConfig: () => ({ urlEndpoint: 'https://ik.imagekit.io/account', privateKey: 'private-test' }),
}));
vi.mock('../../api/_r2Storage.js', () => ({
  isR2MediaUrl: (url) => String(url).startsWith('https://r2.example.com/'),
  getR2Config: () => ({ publicUrl: 'https://r2.example.com', bucket: 'test-bucket', client: { send: mocks.r2Send } }),
}));
vi.mock('../../api/_cloudinaryStorage.js', () => ({
  isCloudinaryMediaUrl: (url) => String(url).startsWith('https://res.cloudinary.com/test-cloud/'),
  getCloudinaryConfig: () => ({ cloudName: 'test-cloud', apiKey: '12345', apiSecret: 'secret-test' }),
}));
const { collectGeneratedAssets, deleteGeneratedAsset, deleteRejectedPlanMedia } = await import('../../api/_contentPlanMedia.js');

afterEach(() => { vi.unstubAllGlobals(); mocks.r2Send.mockReset(); });

const fakeDb = (item) => {
  const rows = new Map([
    ['content_plan_items/item', { ...item }],
    ['scheduled_posts/telegram', { userId: item.userId, groupId: 'plan-item', sourcePlanItemId: 'item', status: 'CANCELLED', mediaUrl: item.resultMediaUrl, approvalStatus: 'REJECTED' }],
  ]);
  const ref = (name, id) => ({
    name, id,
    async get() { const data = rows.get(`${name}/${id}`); return { exists: Boolean(data), data: () => data }; },
    async update(patch) { rows.set(`${name}/${id}`, { ...rows.get(`${name}/${id}`), ...patch }); },
  });
  return {
    rows,
    collection(name) { return {
      doc: (id) => ref(name, id),
      where: (field, _op, value) => ({ name, field, value,
        async get() { return { docs: [...rows.entries()]
          .filter(([key, data]) => key.startsWith(`${name}/`) && data[field] === value)
          .map(([key, data]) => ({ id: key.split('/')[1], data: () => data })) }; },
      }),
    }; },
    runTransaction(callback) { return callback({
      async get(target) {
        if (target.field) return { docs: [...rows.entries()]
          .filter(([key, data]) => key.startsWith(`${target.name}/`) && data[target.field] === target.value)
          .map(([key, data]) => ({ id: key.split('/')[1], ref: ref(target.name, key.split('/')[1]), data: () => data })) };
        const data = rows.get(`${target.name}/${target.id}`);
        return { exists: Boolean(data), data: () => data };
      },
      update(target, patch) { rows.set(`${target.name}/${target.id}`, { ...rows.get(`${target.name}/${target.id}`), ...patch }); },
      delete(target) { rows.delete(`${target.name}/${target.id}`); },
    }); },
  };
};

describe('rejected Content Plan media', () => {
  it('collects only generated assets in owned storage folders', () => {
    const assets = collectGeneratedAssets({
      resultMediaUrl: 'https://r2.example.com/telegram-media/output.jpg',
      sourceMediaUrl: 'https://r2.example.com/telegram-media/output.jpg',
      narrationAudio: { mediaUrl: 'https://ik.imagekit.io/account/telegram-media/audio.mp3', fileId: 'audio-id' },
      avatarImage: { mediaUrl: 'https://other.example.com/customer-photo.jpg' },
    });
    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.provider).sort()).toEqual(['imagekit', 'r2']);
    expect(assets.find((asset) => asset.provider === 'imagekit').fileId).toBe('audio-id');
  });

  it('deletes an R2 object by its stored key', async () => {
    mocks.r2Send.mockResolvedValue({});
    await deleteGeneratedAsset(collectGeneratedAssets({ resultMediaUrl: 'https://r2.example.com/generation-history/photo.jpg' })[0]);
    expect(mocks.r2Send).toHaveBeenCalledOnce();
    expect(mocks.r2Send.mock.calls[0][0].input).toMatchObject({ Bucket: 'test-bucket', Key: 'generation-history/photo.jpg' });
  });

  it('resolves an old ImageKit URL to its exact file before deleting', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ filePath: '/telegram-media/old.jpg', fileId: 'old-id' }] })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await deleteGeneratedAsset(collectGeneratedAssets({ resultMediaUrl: 'https://ik.imagekit.io/account/telegram-media/old.jpg?tr=w-1280' })[0]);
    expect(fetchMock.mock.calls[0][0]).toContain('path=%2Ftelegram-media');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.imagekit.io/v1/files/old-id');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('calls Cloudinary destroy for its own generated asset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    const asset = collectGeneratedAssets({ resultMediaUrl: 'https://res.cloudinary.com/test-cloud/image/upload/v1/aime/generation-history/photo.jpg' })[0];
    await deleteGeneratedAsset(asset);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/test-cloud/image/destroy');
    expect(fetchMock.mock.calls[0][1].body.get('public_id')).toBe('aime/generation-history/photo');
  });

  it('uses Cloudinary asset ID for a newly generated video', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    const asset = collectGeneratedAssets({ generatedAssets: [{
      mediaUrl: 'https://res.cloudinary.com/test-cloud/video/upload/v1/aime/telegram-media/video.mp4',
      fileId: 'asset-id', filePath: 'aime/telegram-media/video', mediaType: 'video',
    }] })[0];
    await deleteGeneratedAsset(asset);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/test-cloud/destroy');
    expect(fetchMock.mock.calls[0][1].body.get('asset_id')).toBe('asset-id');
  });

  it('keeps rejection cancelled and retries provider deletion before removing the item', async () => {
    const db = fakeDb({ status: 'DELETING', userId: 'owner', resultMediaUrl: 'https://ik.imagekit.io/account/telegram-media/photo.jpg', generatedAssets: [{ mediaUrl: 'https://ik.imagekit.io/account/telegram-media/photo.jpg', fileId: 'photo-id' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 204 }));
    expect((await deleteRejectedPlanMedia(db, 'item')).deleted).toBe(false);
    expect(db.rows.get('content_plan_items/item').status).toBe('DELETE_FAILED');
    expect(db.rows.get('scheduled_posts/telegram').status).toBe('CANCELLED');
    expect((await deleteRejectedPlanMedia(db, 'item')).deleted).toBe(true);
    expect(db.rows.has('content_plan_items/item')).toBe(false);
    expect(db.rows.get('scheduled_posts/telegram')).toMatchObject({ status: 'CANCELLED', mediaUrl: '' });
  });

  it('deletes a video output, source, narration, and generated avatar', async () => {
    mocks.r2Send.mockResolvedValue({});
    const base = 'https://r2.example.com/telegram-media/';
    const db = fakeDb({
      status: 'DELETING', userId: 'owner', resultMediaUrl: `${base}final.mp4`,
      sourceMediaUrl: `${base}source.mp4`,
      narrationAudio: { mediaUrl: `${base}speech.mp3`, fileId: 'telegram-media/speech.mp3' },
      avatarImage: { mediaUrl: `${base}avatar.jpg`, fileId: 'telegram-media/avatar.jpg' },
    });
    expect((await deleteRejectedPlanMedia(db, 'item')).deleted).toBe(true);
    expect(mocks.r2Send.mock.calls.map(([command]) => command.input.Key).sort()).toEqual([
      'telegram-media/avatar.jpg', 'telegram-media/final.mp4',
      'telegram-media/source.mp4', 'telegram-media/speech.mp3',
    ]);
  });

  it('does not delete media still used by another published post', async () => {
    const mediaUrl = 'https://r2.example.com/telegram-media/photo.jpg';
    const db = fakeDb({ status: 'DELETING', userId: 'owner', resultMediaUrl: mediaUrl });
    db.rows.set('scheduled_posts/other', { sourcePlanItemId: 'other-item', status: 'PUBLISHED', mediaUrl });
    expect((await deleteRejectedPlanMedia(db, 'item')).deleted).toBe(false);
    expect(mocks.r2Send).not.toHaveBeenCalled();
    expect(db.rows.get('content_plan_items/item').status).toBe('DELETE_FAILED');
  });
});
