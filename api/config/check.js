export default function handler(req, res) {
  // SecurityCenter.tsx's Security Overview page tells users this endpoint "only
  // returns booleans (key present or not), never the values" -- it previously
  // returned the actual computed/configured TikTok redirect URI strings here,
  // contradicting that documented guarantee (low sensitivity in practice, since
  // redirect URIs are also visible during the OAuth flow itself, but the code
  // should match what the security page claims it does).
  res.status(200).json({
    tiktok: {
      hasClientKey: !!(process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY),
      hasClientSecret: !!(process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET),
      hasRedirectUri: !!(process.env.TIKTOK_REDIRECT_URI || process.env.VITE_TIKTOK_REDIRECT_URI),
    },
    firebase: {
      isInitialized: !!process.env.FIREBASE_PROJECT_ID,
    },
  });
}
