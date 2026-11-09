import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FieldValue } from 'firebase-admin/firestore';
import { getImageKitConfig } from './_imagekitUpload.js';
import { getR2Config, isR2MediaUrl } from './_r2Storage.js';
import { getCloudinaryConfig, isCloudinaryMediaUrl } from './_cloudinaryStorage.js';

const ownedFolder = (path) => /^\/(?:telegram-media|generation-history)\//.test(path);
const retryDelayMs = 10 * 60_000;

export function generatedAsset(upload, mediaType) {
  const mediaUrl = String(upload?.mediaUrl || '');
  if (!mediaUrl) return null;
  const asset = assetFromUrl(mediaUrl);
  if (!asset) return null;
  return {
    ...asset,
    ...(upload.fileId ? { fileId: String(upload.fileId) } : {}),
    ...(upload.filePath ? { filePath: String(upload.filePath) } : {}),
    mediaType: mediaType || upload.mediaType || asset.mediaType,
  };
}

export function assetFromUrl(mediaUrl) {
  try {
    const url = new URL(String(mediaUrl || ''));
    if (isR2MediaUrl(url.toString())) {
      const base = new URL(getR2Config().publicUrl);
      const key = decodeURIComponent(url.pathname.slice(base.pathname.replace(/\/$/, '').length + 1));
      if (!ownedFolder(`/${key}`)) return null;
      return { provider: 'r2', mediaUrl: url.toString(), fileId: key, filePath: `/${key}` };
    }
    if (isCloudinaryMediaUrl(url.toString())) {
      const cloudName = getCloudinaryConfig().cloudName;
      const match = url.pathname.match(new RegExp(`^/${cloudName}/(image|video|raw)/upload/(?:v\\d+/)?(aime/(?:telegram-media|generation-history)/.+)$`));
      if (!match) return null;
      const publicId = decodeURIComponent(match[2]).replace(match[1] === 'raw' ? /$^/ : /\.[^/.]+$/, '');
      return { provider: 'cloudinary', mediaUrl: url.toString(), filePath: publicId, resourceType: match[1] };
    }
    const endpoint = new URL(getImageKitConfig().urlEndpoint);
    const prefix = endpoint.pathname.replace(/\/$/, '');
    if (url.protocol !== 'https:' || url.hostname !== endpoint.hostname || !url.pathname.startsWith(`${prefix}/`)) return null;
    const filePath = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!ownedFolder(filePath)) return null;
    return { provider: 'imagekit', mediaUrl: url.toString(), filePath };
  } catch { return null; }
}

export function collectGeneratedAssets(item) {
  const candidates = [
    item?.sourceMediaAsset, item?.narrationAudio, item?.avatarImage,
    ...(Array.isArray(item?.generatedAssets) ? item.generatedAssets : []),
    item?.resultMediaUrl, item?.sourceMediaUrl,
  ];
  const seen = new Set();
  return candidates.map((candidate) => {
    const asset = typeof candidate === 'string' ? assetFromUrl(candidate) : generatedAsset(candidate, candidate?.mediaType);
    if (!asset) return null;
    const key = `${asset.provider}:${asset.filePath || asset.fileId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    return { ...asset, key };
  }).filter(Boolean);
}

async function resolveImageKitFileId(asset) {
  if (asset.fileId) return asset.fileId;
  const { privateKey } = getImageKitConfig();
  const folder = `${asset.filePath.slice(0, asset.filePath.lastIndexOf('/'))}/`;
  for (let skip = 0; skip <= 1000; skip += 100) {
    const query = new URLSearchParams({ path: folder, limit: '100', skip: String(skip) });
    const response = await fetch(`https://api.imagekit.io/v1/files?${query}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`ImageKit file lookup failed (HTTP ${response.status}).`);
    const files = await response.json();
    if (!Array.isArray(files)) throw new Error('ImageKit returned an invalid file list.');
    const exact = files.find((file) => file.filePath === asset.filePath);
    if (exact) return exact.fileId;
    if (files.length < 100) return null;
  }
  throw new Error('ImageKit file lookup exceeded its safe page limit.');
}

export async function deleteGeneratedAsset(asset) {
  if (asset.provider === 'r2') {
    const { client, bucket } = getR2Config();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.fileId }));
    return;
  }
  if (asset.provider === 'imagekit') {
    const fileId = await resolveImageKitFileId(asset);
    if (!fileId) return;
    const { privateKey } = getImageKitConfig();
    const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`ImageKit deletion failed (HTTP ${response.status}).`);
    return;
  }
  if (asset.provider === 'cloudinary') {
    const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
    const timestamp = Math.floor(Date.now() / 1000);
    const assetId = asset.fileId && /^[A-Za-z0-9_-]+$/.test(asset.fileId) ? asset.fileId : null;
    const publicId = asset.filePath;
    const parameters = assetId ? { asset_id: assetId, invalidate: 'true', timestamp: String(timestamp) }
      : { public_id: publicId, invalidate: 'true', timestamp: String(timestamp) };
    const signed = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
    const signature = createHash('sha256').update(`${signed}${apiSecret}`).digest('hex');
    const body = new URLSearchParams({ ...parameters, api_key: apiKey, signature });
    const resourceType = asset.resourceType || (asset.mediaType === 'video' || asset.mediaType === 'audio' ? 'video' : 'image');
    const path = assetId ? 'destroy' : `${resourceType}/destroy`;
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${path}`, {
      method: 'POST', body, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !['ok', 'not found'].includes(data.result)) throw new Error(`Cloudinary deletion failed (HTTP ${response.status}).`);
  }
}

export async function deleteRejectedPlanMedia(db, itemId) {
  const ref = db.collection('content_plan_items').doc(itemId);
  const claimId = randomUUID();
  const item = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data || !['DELETING', 'DELETE_FAILED'].includes(data.status)) return null;
    const claimedAt = data.deletionClaimedAt?.toMillis?.() || 0;
    if (Date.now() - claimedAt < 5 * 60_000) return null;
    tx.update(ref, { status: 'DELETING', deletionClaimedAt: FieldValue.serverTimestamp(), deletionClaimId: claimId });
    return data;
  });
  if (!item) return { skipped: true };
  try {
    // Never report deletion complete while an output or intermediate still
    // points at storage we cannot identify (for example, missing credentials
    // for a legacy provider). Keep the item for retry instead.
    const requiredUrls = [item.resultMediaUrl, item.sourceMediaUrl, item.sourceMediaAsset?.mediaUrl,
      item.narrationAudio?.mediaUrl, item.avatarImage?.mediaUrl,
      ...(Array.isArray(item.generatedAssets) ? item.generatedAssets.map((asset) => asset?.mediaUrl) : [])]
      .filter(Boolean);
    if (requiredUrls.some((url) => !assetFromUrl(url))) {
      throw new Error('A generated media file could not be located in configured storage.');
    }
    const shared = item.resultMediaUrl ? await Promise.all(['mediaUrl', 'videoUrl'].map((field) =>
      db.collection('scheduled_posts').where(field, '==', item.resultMediaUrl).get())) : [];
    if (shared.some((snapshot) => snapshot.docs.some((post) => post.data()?.sourcePlanItemId !== itemId
      && !['CANCELLED', 'FAILED'].includes(post.data()?.status)))) {
      throw new Error('The generated media is still referenced by another active or published post.');
    }
    for (const asset of collectGeneratedAssets(item)) {
      if (item.deletedAssetKeys?.includes(asset.key)) continue;
      await deleteGeneratedAsset(asset);
      await ref.update({ deletedAssetKeys: FieldValue.arrayUnion(asset.key) });
    }
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists || fresh.data()?.deletionClaimId !== claimId) return;
      const posts = await tx.get(db.collection('scheduled_posts').where('sourcePlanItemId', '==', itemId));
      const ownPosts = posts.docs.filter((post) => post.data()?.userId === fresh.data()?.userId
        && post.data()?.groupId === `plan-${itemId}`);
      if (ownPosts.some((post) => post.data()?.status === 'PUBLISHED' || post.data()?.status === 'PROCESSING')) {
        throw new Error('A destination has already published or is still processing.');
      }
      ownPosts.forEach((post) => tx.update(post.ref, {
        status: 'CANCELLED', approvalStatus: 'REJECTED', mediaUrl: '', videoUrl: '', mediaDeletedAt: FieldValue.serverTimestamp(),
      }));
      tx.delete(ref);
    });
    return { deleted: true };
  } catch (error) {
    await ref.update({ status: 'DELETE_FAILED', deletionClaimedAt: null, deletionError: String(error?.message || error).slice(0, 300), nextDeletionRetryAt: Date.now() + retryDelayMs }).catch(() => {});
    return { deleted: false, error: String(error?.message || error) };
  }
}
