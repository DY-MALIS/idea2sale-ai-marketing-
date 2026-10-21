import { createHmac } from 'node:crypto';
import admin, { initFirebaseAdmin } from './_firebaseAdmin.js';
import { createImageKitUploadAuth, getImageKitConfig } from './_imagekitUpload.js';
import { extractDocumentText } from './_documentExtract.js';

const COLLECTION = 'business_profile_files';
const MAX_BYTES = 8 * 1024 * 1024;
const acceptedId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(value);
const folderFor = (uid) => `/business-profile-files/${uid}/`;

const authenticate = async (req) => {
  const match = String(req.headers.authorization || '').match(/^Bearer (\S+)$/);
  if (!match) return null;
  initFirebaseAdmin();
  return admin.auth().verifyIdToken(match[1], true);
};

const imageKitFile = async (fileId) => {
  const { privateKey } = getImageKitConfig();
  const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}/details`, {
    headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
  });
  if (!response.ok) throw Object.assign(new Error('Uploaded file could not be verified.'), { status: 400 });
  return response.json();
};

const signedDownloadUrl = (path) => {
  const { privateKey, urlEndpoint } = getImageKitConfig();
  const expires = Math.floor(Date.now() / 1000) + 300;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const signature = createHmac('sha1', privateKey).update(`${encodedPath.replace(/^\//, '')}${expires}`).digest('hex');
  return `${urlEndpoint}/${encodedPath.replace(/^\//, '')}?ik-t=${expires}&ik-s=${signature}`;
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const user = await authenticate(req);
    if (!user) return res.status(401).json({ error: 'Sign in to save business files.' });
    const db = initFirebaseAdmin();
    const action = String(req.query?.action || req.body?.action || 'list');

    if (req.method === 'GET' && action === 'list') {
      const docs = await db.collection(COLLECTION).where('ownerId', '==', user.uid).limit(50).get();
      return res.status(200).json({ files: docs.docs.map((doc) => ({ id: doc.id, name: doc.data().name, size: doc.data().size, createdAt: doc.data().createdAt || '' })) });
    }

    if (req.method === 'POST' && action === 'auth') {
      const auth = createImageKitUploadAuth();
      return res.status(200).json({ ...auth, folder: folderFor(user.uid), maxBytes: MAX_BYTES });
    }

    const fileId = String(req.query?.fileId || req.body?.fileId || '');
    if (!acceptedId(fileId)) return res.status(400).json({ error: 'Invalid file ID.' });

    if (req.method === 'POST' && action === 'finalize') {
      const details = await imageKitFile(fileId);
      const filePath = String(details.filePath || '');
      if (!filePath.startsWith(folderFor(user.uid)) || details.isPrivateFile !== true || !Number.isFinite(details.size) || details.size < 1 || details.size > MAX_BYTES) {
        return res.status(403).json({ error: 'This file is not a private file in your account.' });
      }
      const name = String(req.body?.name || details.name || '').slice(0, 180);
      if (!name) return res.status(400).json({ error: 'File name is required.' });
      const saved = { ownerId: user.uid, name, filePath, size: details.size, createdAt: new Date().toISOString() };
      const ref = db.collection(COLLECTION).doc(fileId);
      const existing = await ref.get();
      if (existing.exists && existing.data().ownerId !== user.uid) return res.status(403).json({ error: 'Access denied.' });
      if (!existing.exists) await ref.create(saved);
      return res.status(200).json({ file: { id: fileId, name: saved.name, size: saved.size, createdAt: saved.createdAt } });
    }

    const snap = await db.collection(COLLECTION).doc(fileId).get();
    if (!snap.exists || snap.data().ownerId !== user.uid) return res.status(404).json({ error: 'File not found.' });
    if (req.method === 'GET' && action === 'download') {
      const details = await imageKitFile(fileId);
      if (details.isPrivateFile !== true || details.filePath !== snap.data().filePath || !details.filePath.startsWith(folderFor(user.uid))) {
        return res.status(403).json({ error: 'File access could not be verified.' });
      }
      return res.status(200).json({ url: signedDownloadUrl(details.filePath) });
    }
    if (req.method === 'POST' && action === 'extract') {
      const details = await imageKitFile(fileId);
      if (details.isPrivateFile !== true || details.filePath !== snap.data().filePath || !details.filePath.startsWith(folderFor(user.uid))) {
        return res.status(403).json({ error: 'File access could not be verified.' });
      }
      const response = await fetch(signedDownloadUrl(details.filePath));
      if (!response.ok) throw Object.assign(new Error('Could not read the stored file.'), { status: 422 });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'File exceeds the 8 MB limit.' });
      const text = await extractDocumentText({
        dataUrl: `data:${details.mime || 'application/octet-stream'};base64,${buffer.toString('base64')}`,
        fileName: snap.data().name,
      });
      const knowledge = text.slice(0, 4000);
      await db.collection('business_profiles').doc(user.uid).set({ businessDocumentKnowledge: knowledge }, { merge: true });
      return res.status(200).json({ businessDocumentKnowledge: knowledge });
    }
    if (req.method === 'DELETE' && action === 'delete') {
      const { privateKey } = getImageKitConfig();
      const response = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE', headers: { Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}` },
      });
      if (!response.ok && response.status !== 404) throw new Error('Could not remove the stored file.');
      await snap.ref.delete();
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Unsupported action.' });
  } catch (error) {
    const status = error?.code?.startsWith?.('auth/') ? 401 : (error.status || 500);
    console.error('profile-files:', error?.message || error);
    return res.status(status).json({ error: status === 500 ? 'Could not complete the file request.' : error.message });
  }
}
