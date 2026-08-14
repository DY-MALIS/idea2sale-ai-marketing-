import { createOAuthState, getTikTokAuthUrl, oauthStateCookieHeader } from '../../_tiktok.js';

export default function handler(req, res) {
  try {
    const state = createOAuthState();
    res.setHeader('Set-Cookie', oauthStateCookieHeader(state));
    res.redirect(302, getTikTokAuthUrl(req, state));
  } catch (error) {
    res.status(500).send(error.message || 'Failed to start TikTok auth');
  }
}
