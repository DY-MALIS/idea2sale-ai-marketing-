import { getRedirectUri, getTikTokAuthUrl } from '../_tiktok.js';

export default function handler(req, res) {
  try {
    res.status(200).json({
      url: getTikTokAuthUrl(req),
      redirectUri: getRedirectUri(req),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to start TikTok auth' });
  }
}
