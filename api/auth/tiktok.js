import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { createOAuthState, getRedirectUri, getTikTokAuthUrl, oauthStateCookieHeader, oauthOwnerCookieHeader } from '../_tiktok.js';
import { getYouTubeAuthUrl, getYouTubeRedirectUri, youtubeOwnerCookieHeader, youtubeStateCookieHeader } from '../_youtube.js';
import { facebookAuthUrl, facebookRedirectUri, facebookAuthCookies } from '../_facebook.js';

export default async function handler(req, res) {
  const isYouTube = req.query?.provider === 'youtube';
  const isFacebook = req.query?.provider === 'facebook';
  try {
    const idToken = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!idToken) return res.status(401).json({ error: isFacebook ? 'Sign in before connecting Facebook.' : isYouTube ? 'Sign in before connecting YouTube.' : 'Sign in before connecting TikTok.' });
    initFirebaseAdmin();
    const owner = await admin.auth().verifyIdToken(idToken, true);
    const state = createOAuthState();
    res.setHeader('Set-Cookie', isFacebook ? facebookAuthCookies(owner.uid, state, req) : [
      isYouTube ? youtubeStateCookieHeader(state, req) : oauthStateCookieHeader(state, req),
      isYouTube ? youtubeOwnerCookieHeader(owner.uid, state, req) : oauthOwnerCookieHeader(owner.uid, state, req),
    ]);
    res.status(200).json({
      url: isFacebook ? facebookAuthUrl(state) : isYouTube ? getYouTubeAuthUrl(req, state) : getTikTokAuthUrl(req, state),
      redirectUri: isFacebook ? facebookRedirectUri() : isYouTube ? getYouTubeRedirectUri(req) : getRedirectUri(req),
    });
  } catch (error) {
    const message = error?.message || `Failed to start ${isFacebook ? 'Facebook' : isYouTube ? 'YouTube' : 'TikTok'} auth`;
    res.status((isYouTube || isFacebook) && /not configured/i.test(message) ? 503 : 401).json({ error: message });
  }
}
