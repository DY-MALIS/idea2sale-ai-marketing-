import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

const OAUTH_STATE_COOKIE = 'tiktok_oauth_state';
const AUTOMATION_TOKEN_COLLECTION = 'tiktok_automation_tokens';
// The app has one shared TikTok connection (see getCookie's doc comment above),
// not a per-user one, so automation reuses that same single connection under a
// fixed doc id rather than trying to pick "whose" token a cron run should use.
const AUTOMATION_TOKEN_DOC = 'default';

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

// Persists the tokens from a successful OAuth exchange so the cron auto-publisher
// (api/tiktok/publish.js's ?action=cron) can call the TikTok API without a live
// browser session -- the tiktok_token cookie set alongside this is short-lived and
// only ever available on the request that just connected the account. Best-effort
// by design: called from api/tiktok/callback.js, where a Firestore hiccup here
// must never block the user's own connect flow from completing.
export async function saveAutomationTokens(db, { accessToken, refreshToken, expiresIn, refreshExpiresIn, openId }) {
  const now = Date.now();
  await db.collection(AUTOMATION_TOKEN_COLLECTION).doc(AUTOMATION_TOKEN_DOC).set({
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: now + (Number(expiresIn) || 0) * 1000,
    refreshExpiresAt: now + (Number(refreshExpiresIn) || 0) * 1000,
    openId: openId || null,
    refreshingAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// Returns a valid access token for the shared automation connection, refreshing
// it first if it's expiring soon. Returns null (not a thrown error) when nothing
// has ever been connected, so callers can treat "not connected" as a normal,
// retryable state rather than a failure.
export async function getAutomationAccessToken(db) {
  const ref = db.collection(AUTOMATION_TOKEN_COLLECTION).doc(AUTOMATION_TOKEN_DOC);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  if (data.accessToken && data.expiresAt && data.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return data.accessToken;
  }
  if (!data.refreshToken) {
    // Nothing left to refresh with -- surface the stale token if present so the
    // caller's TikTok API call fails with TikTok's own "token expired" error
    // rather than a vaguer one from here.
    return data.accessToken || null;
  }

  // Claim the refresh so two concurrent callers -- the Vercel daily cron and
  // the GitHub Action's 10-minute poller both hit this once the stored token
  // nears expiry -- can't both submit the same refresh_token to TikTok at
  // once. If TikTok rotates/invalidates a refresh_token on first use, the
  // loser's request fails, or worse persists a token pair the winner's refresh
  // has already superseded. A stale claim (a prior refresh crashed mid-request)
  // is abandoned after REFRESH_CLAIM_STALE_MS.
  const REFRESH_CLAIM_STALE_MS = 30 * 1000;
  const claim = await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(ref);
    const freshData = freshSnap.data() || {};
    if (freshData.accessToken && freshData.expiresAt && freshData.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return { accessToken: freshData.accessToken };
    }
    const refreshingAtMs = freshData.refreshingAt?.toMillis?.();
    if (typeof refreshingAtMs === 'number' && Date.now() - refreshingAtMs < REFRESH_CLAIM_STALE_MS) {
      return { inProgress: true };
    }
    tx.update(ref, { refreshingAt: FieldValue.serverTimestamp() });
    return { claimed: true };
  });

  if (claim.accessToken) return claim.accessToken;
  if (claim.inProgress) {
    // Someone else is refreshing right now -- surface the pre-refresh token
    // rather than racing them with the same refresh_token.
    return data.accessToken || null;
  }

  const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET || '').trim();
  if (!clientKey || !clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are not configured; cannot refresh the TikTok automation token.');
  }

  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: data.refreshToken,
    }).toString(),
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) {
    throw new Error(refreshed?.error_description || refreshed?.error || 'TikTok token refresh failed.');
  }

  await saveAutomationTokens(db, {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || data.refreshToken,
    expiresIn: refreshed.expires_in,
    refreshExpiresIn: refreshed.refresh_expires_in,
    openId: data.openId,
  });

  return refreshed.access_token;
}

// Shared by the manual "Publish to TikTok" button (cookie token) and the cron
// auto-publisher (stored automation token) so the "Recent TikTok Syncs" widget
// in TikTokAnalytics.tsx (reads the tiktok_posts collection) sees both paths.
export async function recordTikTokPostSync(db, { publishId, title, videoUrl, userId, mode, mediaType }) {
  if (!publishId) return;
  await db.collection('tiktok_posts').doc(publishId).set({
    videoId: publishId,
    status: 'PROCESSING',
    title,
    videoUrl,
    userId: userId || null,
    mode: mode || 'inbox',
    ...(mediaType ? { mediaType } : {}),
    createdAt: FieldValue.serverTimestamp(),
  });
}
