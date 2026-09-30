import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { createOAuthState, getRedirectUri, getTikTokAuthUrl, oauthStateCookieHeader, oauthOwnerCookieHeader } from '../_tiktok.js';

export default async function handler(req, res) {
  try {
    const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!idToken) return res.status(401).json({ error: 'Sign in before connecting TikTok.' });
    initFirebaseAdmin();
    const owner = await admin.auth().verifyIdToken(idToken, true);
    const state = createOAuthState();
    res.setHeader('Set-Cookie', [oauthStateCookieHeader(state, req), oauthOwnerCookieHeader(owner.uid, state, req)]);
    res.status(200).json({
      url: getTikTokAuthUrl(req, state),
      redirectUri: getRedirectUri(req),
    });
  } catch (error) {
    res.status(401).json({ error: error.message || 'Failed to start TikTok auth' });
  }
}
