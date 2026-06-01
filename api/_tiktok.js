export function getRedirectUri(req) {
  const configured = process.env.TIKTOK_REDIRECT_URI || process.env.VITE_TIKTOK_REDIRECT_URI;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');

  if (configured && configured.trim().startsWith('http')) {
    const configuredUri = configured.trim();
    const configuredIsLocal = configuredUri.includes('localhost') || configuredUri.includes('127.0.0.1');
    const requestIsLocal = String(host).includes('localhost') || String(host).includes('127.0.0.1');
    if (!configuredIsLocal || requestIsLocal) {
      return configuredUri;
    }
  }

  return `${protocol}://${host}/api/tiktok/callback`;
}

export function getTikTokAuthUrl(req) {
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || '').trim();
  if (!clientKey) {
    throw new Error('TIKTOK_CLIENT_KEY is not configured');
  }

  const redirectUri = getRedirectUri(req);
  const scope = 'user.info.basic';
  const state = 'idea2sale_login_kit';

  return `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(clientKey)}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}
