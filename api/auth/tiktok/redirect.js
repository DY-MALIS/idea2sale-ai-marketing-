import { getTikTokAuthUrl } from '../../_tiktok.js';

export default function handler(req, res) {
  try {
    res.redirect(302, getTikTokAuthUrl(req));
  } catch (error) {
    res.status(500).send(error.message || 'Failed to start TikTok auth');
  }
}
