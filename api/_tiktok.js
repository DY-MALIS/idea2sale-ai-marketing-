import crypto from 'crypto';

const OAUTH_STATE_COOKIE = 'tiktok_oauth_state';

// Anti-CSRF state for the TikTok OAuth flow: a fresh random value per attempt,
// stashed in a short-lived HttpOnly cookie by whichever endpoint starts the
// flow (api/auth/tiktok.js or api/auth/tiktok/redirect.js) and checked back
// against the callback's ?state= by verifyAndClearOAuthState below.
export function createOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

export function oauthStateCookieHeader(state) {
  return `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=600`;
}

// Always clear the one-time cookie (success or failure) so a captured callback
// URL can't be replayed. Returns whether the callback's state actually matches
// what this browser was issued.
export function verifyAndClearOAuthState(req, res) {
  const cookieState = getCookie(req, OAUTH_STATE_COOKIE);
  const existing = res.getHeader('Set-Cookie');
  const clearCookie = `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0`;
  res.setHeader('Set-Cookie', existing ? [].concat(existing, clearCookie) : clearCookie);

  const queryState = String(req.query?.state || '');
  return Boolean(cookieState) && cookieState === queryState;
}

// Single source of truth for reading TikTok-related cookies -- publish.js and
// publish-photo.js used to have their own copy that skipped decodeURIComponent,
// diverging from this one (used by me.js/stats.js) if the cookie value ever
// needed URL-decoding.
export function getCookie(req, name) {
  const match = String(req.headers.cookie || '').split(';').find((item) => item.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.trim().slice(name.length + 1)) : '';
}

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

  // APP_URL is what README tells operators to keep in sync with the deployed
  // domain -- preferring it over request headers avoids a redirect_uri mismatch
  // on custom domain aliases, preview URLs, or proxies where the inbound
  // Host/x-forwarded-host header doesn't exactly match the registered domain.
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.trim().replace(/\/$/, '')}/api/tiktok/callback`;
  }

  return `${protocol}://${host}/api/tiktok/callback`;
}

// `state` must be caller-supplied (a fresh random value per auth attempt, set as
// an HttpOnly cookie by the caller and re-checked in callback.js) -- it used to be
// a fixed constant here, which is not a CSRF token at all since it never varies
// and the callback never checked it against anything, so any `code` presented to
// the callback was exchanged regardless of where it actually came from.
export function getTikTokAuthUrl(req, state) {
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || '').trim();
  if (!clientKey) {
    throw new Error('TIKTOK_CLIENT_KEY is not configured');
  }
  if (!state) {
    throw new Error('An OAuth state value is required');
  }

  const redirectUri = getRedirectUri(req);
  const scope = (process.env.TIKTOK_SCOPES || 'user.info.basic,user.info.stats').trim();

  return `https://www.tiktok.com/v2/auth/authorize/?client_key=${encodeURIComponent(clientKey)}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}
