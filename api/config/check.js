import { getRedirectUri } from '../_tiktok.js';

export default function handler(req, res) {
  res.status(200).json({
    tiktok: {
      hasClientKey: !!(process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY),
      hasClientSecret: !!(process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET),
      redirectUri: getRedirectUri(req),
      configuredUri: process.env.TIKTOK_REDIRECT_URI || process.env.VITE_TIKTOK_REDIRECT_URI || 'None',
    },
    firebase: {
      isInitialized: !!process.env.FIREBASE_PROJECT_ID,
    },
  });
}
