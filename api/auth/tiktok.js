import { createOAuthState, getRedirectUri, getTikTokAuthUrl, oauthStateCookieHeader } from '../_tiktok.js';

export default function handler(req, res) {
  try {
    const state = createOAuthState();
    res.setHeader('Set-Cookie', oauthStateCookieHeader(state));
    res.status(200).json({
      url: getTikTokAuthUrl(req, state),
      redirectUri: getRedirectUri(req),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to start TikTok auth' });
  }
}
