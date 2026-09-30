import { createOAuthState, getTikTokAuthUrl, oauthStateCookieHeader } from '../../_tiktok.js';
import { getYouTubeAuthUrl } from '../../_youtube.js';

// Also handles YouTube's connect redirect (?provider=youtube) -- folded into
// this file instead of a new api/auth/youtube/redirect.js because the
// deployment is already at Vercel Hobby's 12-serverless-function cap (see the
// comment in api/tiktok/publish.js for the same constraint elsewhere).
export default function handler(req, res) {
  const provider = String(req.query?.provider || 'tiktok').toLowerCase();
  try {
    if (provider !== 'youtube') return res.status(401).send('Connect TikTok from your signed-in profile.');
    const state = createOAuthState();
    res.setHeader('Set-Cookie', oauthStateCookieHeader(state, req));
    const url = provider === 'youtube' ? getYouTubeAuthUrl(req, state) : getTikTokAuthUrl(req, state);
    res.redirect(302, url);
  } catch (error) {
    res.status(500).send(error.message || `Failed to start ${provider} auth`);
  }
}
