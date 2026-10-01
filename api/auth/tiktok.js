import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { createOAuthState, getRedirectUri, getTikTokAuthUrl, oauthStateCookieHeader, oauthOwnerCookieHeader } from '../_tiktok.js';
import { getYouTubeAuthUrl, getYouTubeRedirectUri, youtubeOwnerCookieHeader } from '../_youtube.js';

export default async function handler(req, res) {
  const isYouTube = req.query?.provider === 'youtube';
  try {
    const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!idToken) return res.status(401).json({ error: isYouTube ? 'Sign in before connecting YouTube.' : 'Sign in before connecting TikTok.' });
    initFirebaseAdmin();
    const owner = await admin.auth().verifyIdToken(idToken, true);
    const state = createOAuthState();
    res.setHeader('Set-Cookie', [
      oauthStateCookieHeader(state, req),
      isYouTube ? youtubeOwnerCookieHeader(owner.uid, state, req) : oauthOwnerCookieHeader(owner.uid, state, req),
    ]);
    res.status(200).json({
      url: isYouTube ? getYouTubeAuthUrl(req, state) : getTikTokAuthUrl(req, state),
      redirectUri: isYouTube ? getYouTubeRedirectUri(req) : getRedirectUri(req),
    });
  } catch (error) {
    const message = error?.message || `Failed to start ${isYouTube ? 'YouTube' : 'TikTok'} auth`;
    res.status(isYouTube && /not configured/i.test(message) ? 503 : 401).json({ error: message });
  }
}
