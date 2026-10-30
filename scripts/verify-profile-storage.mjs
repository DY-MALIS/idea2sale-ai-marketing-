import 'dotenv/config';
import { createHmac } from 'node:crypto';

const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
const publicKey = process.env.IMAGEKIT_PUBLIC_KEY;
const endpoint = process.env.IMAGEKIT_URL_ENDPOINT?.replace(/\/$/, '');
if (!privateKey || !publicKey || !endpoint) throw new Error('ImageKit configuration is missing.');
const basic = `Basic ${Buffer.from(`${privateKey}:`).toString('base64')}`;
let fileId;
try {
  const form = new FormData();
  form.set('file', new Blob(['Profile storage verification.'], { type: 'text/plain' }), 'profile-storage-check.txt');
  form.set('fileName', 'profile-storage-check.txt');
  form.set('folder', '/business-profile-files/verification/');
  form.set('isPrivateFile', 'true');
  form.set('useUniqueFileName', 'true');
  const uploaded = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', headers: { Authorization: basic }, body: form });
  const file = await uploaded.json();
  if (!uploaded.ok) throw new Error(`Upload failed: HTTP ${uploaded.status}`);
  fileId = file.fileId;
  if (!fileId) throw new Error('Upload did not return a file ID.');
  const detailsResponse = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}/details`, { headers: { Authorization: basic } });
  const details = await detailsResponse.json();
  if (!detailsResponse.ok || details.isPrivateFile !== true || !details.filePath.startsWith('/business-profile-files/verification/')) throw new Error('Private metadata check failed.');
  const anonymous = await fetch(file.url);
  if (![401, 403].includes(anonymous.status)) throw new Error(`Unsigned private file returned HTTP ${anonymous.status}, expected access denial.`);
  const expires = Math.floor(Date.now() / 1000) + 300;
  const encodedPath = details.filePath.split('/').map(encodeURIComponent).join('/').replace(/^\//, '');
  const signature = createHmac('sha1', privateKey).update(`${encodedPath}${expires}`).digest('hex');
  const signed = await fetch(`${endpoint}/${encodedPath}?ik-t=${expires}&ik-s=${signature}`);
  if (!signed.ok || (await signed.text()) !== 'Profile storage verification.') throw new Error(`Signed download failed: HTTP ${signed.status}`);
  console.log('Private upload, metadata, unsigned denial, and signed download passed.');
} finally {
  if (fileId) {
    const removed = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { Authorization: basic } });
    console.log(removed.ok ? 'Verification file deleted.' : `Verification file cleanup returned HTTP ${removed.status}.`);
  }
}
