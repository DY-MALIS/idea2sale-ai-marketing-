import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { getAutomationAccessToken, getCookie, sessionCookieAttributes } from '../_tiktok.js';
import { getYouTubeAutomationAccessToken } from '../_youtube.js';
import { getFacebookPages } from '../_facebook.js';
import tiktokStatsHandler from '../_tiktokStats.js';

// Clears this owner's TikTok connection so a fresh "Connect TikTok" can pick a
// different account -- TikTok's own login page otherwise reuses whatever
// TikTok session is already active in the browser, same as Google did before
// prompt=select_account, so simply clicking "reconnect" without this can land
// back on the same old account. The stored token must be deleted before this
// endpoint reports success, since cron can still publish with it.
async function disconnectTikTok(req, res) {
  // Delete only this user's automation connection after verifying Firebase auth.
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return res.status(401).json({ error: 'Sign in to disconnect TikTok.' });
  let owner;
  try {
    initFirebaseAdmin();
    owner = await admin.auth().verifyIdToken(idToken, true);
  } catch {
    return res.status(401).json({ error: 'Sign in again.' });
  }

  if (getCookie(req, 'tiktok_owner') !== owner.uid) return res.status(403).json({ error: 'This TikTok connection belongs to another profile.' });
  try {
    const db = initFirebaseAdmin();
    await db.collection('tiktok_automation_tokens').doc(owner.uid).delete();
  } catch (error) {
    console.error('Failed to clear stored TikTok automation token:', error?.message || error);
    return res.status(503).json({ error: 'Could not disconnect TikTok. Please try again.' });
  }

  res.setHeader('Set-Cookie', [
    `tiktok_token=; ${sessionCookieAttributes(req)}; Max-Age=0`,
    `tiktok_owner=; ${sessionCookieAttributes(req)}; Max-Age=0`,
  ]);

  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.query?.action === 'facebookAutomation' || req.query?.action === 'selectFacebookPage') {
    const selecting = req.query.action === 'selectFacebookPage';
    if (req.method !== (selecting ? 'POST' : 'GET')) return res.status(405).json({ error: 'Method not allowed' });
    const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!idToken) return res.status(401).json({ error: 'Sign in to manage your Facebook Page.' });
    try {
      const db = initFirebaseAdmin();
      const owner = await admin.auth().verifyIdToken(idToken, true);
      const connection = await getFacebookPages(db, owner.uid);
      const setupReady = Boolean(process.env.FACEBOOK_APP_ID?.trim()
        && process.env.FACEBOOK_APP_SECRET?.trim() && process.env.FACEBOOK_CONFIG_ID?.trim()
        && process.env.APP_URL?.trim());
      if (!connection?.pages?.length) return res.status(200).json({ connected: false, pages: [], setupReady });
      if (selecting) {
        const pageId = String(req.body?.pageId || '');
        if (!connection.pages.some(page => page.id === pageId)) return res.status(400).json({ error: 'Choose a Page you connected.' });
        await db.collection('facebook_automation_tokens').doc(owner.uid).update({ selectedPageId: pageId });
        connection.selectedPageId = pageId;
      }
      return res.status(200).json({ connected: true, setupReady, pages: connection.pages.map(page => ({ id: page.id, name: page.name })), selectedPageId: connection.selectedPageId || connection.pages[0].id });
    } catch (error) {
      console.error('Could not manage Facebook connection:', error?.message || error);
      return res.status(503).json({ error: 'Could not verify your Facebook Page connection.' });
    }
  }
  if (req.query?.route === 'stats') return tiktokStatsHandler(req, res);
  if (req.query?.action === 'youtubeAutomation') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!idToken) return res.status(401).json({ error: 'Sign in to check your YouTube connection.' });
    try {
      const db = initFirebaseAdmin();
      const owner = await admin.auth().verifyIdToken(idToken, true);
      const token = await getYouTubeAutomationAccessToken(db, owner.uid);
      return res.status(200).json({ connected: Boolean(token) });
    } catch (error) {
      console.error('Could not check YouTube automation connection:', error?.message || error);
      return res.status(503).json({ error: 'Could not verify your YouTube connection. Please try again.' });
    }
  }
  if (req.query?.action === 'automation') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!idToken) return res.status(401).json({ error: 'Sign in to check your TikTok connection.' });
    let db;
    let owner;
    try {
      db = initFirebaseAdmin();
      owner = await admin.auth().verifyIdToken(idToken, true);
    } catch {
      return res.status(401).json({ error: 'Sign in again.' });
    }
    try {
      const token = await getAutomationAccessToken(db, owner.uid);
      return res.status(200).json({ connected: Boolean(token) });
    } catch (error) {
      console.error('Could not check TikTok automation connection:', error?.message || error);
      return res.status(503).json({ error: 'Could not verify your TikTok connection. Please try again.' });
    }
  }

  if (req.query?.action === 'disconnect') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return disconnectTikTok(req, res);
  }

  const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!idToken) return res.status(401).json({ error: 'Sign in to view your TikTok connection.' });
  let owner;
  try {
    initFirebaseAdmin();
    owner = await admin.auth().verifyIdToken(idToken, true);
  } catch {
    return res.status(401).json({ error: 'Sign in again.' });
  }
  const token = getCookie(req, 'tiktok_owner') === owner.uid ? getCookie(req, 'tiktok_token') : '';
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
