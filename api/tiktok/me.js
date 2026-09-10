import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { getCookie } from '../_tiktok.js';

// Clears the shared TikTok connection so a fresh "Connect TikTok" can pick a
// different account -- TikTok's own login page otherwise reuses whatever
// TikTok session is already active in the browser, same as Google did before
// prompt=select_account, so simply clicking "reconnect" without this can land
// back on the same old account. Best-effort on the Firestore delete: an
// interrupted request must still clear the cookie so the browser side of the
// disconnect always succeeds.
async function disconnectTikTok(req, res) {
  // Deletes the one shared automation connection every scheduled TikTok post
  // depends on, so this must not be callable by an anonymous request -- unlike
  // the read below (which only needs the TikTok cookie), require a signed-in
  // Firebase user the same way api/tiktok/stats.js does.
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return res.status(401).json({ error: 'Sign in to disconnect TikTok.' });
  try {
    await admin.auth().verifyIdToken(idToken, true);
  } catch {
    return res.status(401).json({ error: 'Sign in again.' });
  }

  const clearCookie = 'tiktok_token=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0';
  res.setHeader('Set-Cookie', clearCookie);

  try {
    const db = initFirebaseAdmin();
    await db.collection('tiktok_automation_tokens').doc('default').delete();
  } catch (error) {
    console.error('Failed to clear stored TikTok automation token:', error?.message || error);
  }

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.query?.action === 'disconnect') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return disconnectTikTok(req, res);
  }

  const token = getCookie(req, 'tiktok_token');
  if (!token) return res.status(401).json({ error: 'Not connected to TikTok', code: 'not_connected' });

  try {
    const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();

    if (!response.ok || payload?.error?.code !== 'ok') {
      return res.status(response.status || 400).json({
        error: payload?.error?.message || 'Failed to fetch TikTok user info',
        code: payload?.error?.code || 'tiktok_error',
      });
    }

    const user = payload.data?.user || {};
    return res.status(200).json({
      open_id: user.open_id || '',
      avatar_url: user.avatar_url || '',
      display_name: user.display_name || user.username || 'TikTok user',
      username: user.username || '',
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch TikTok user info' });
  }
}
