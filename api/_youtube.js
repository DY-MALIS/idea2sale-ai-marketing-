import { FieldValue } from 'firebase-admin/firestore';

// YouTube's OAuth + upload helpers, mirroring api/_tiktok.js's shape (shared
// automation connection stored in Firestore, refreshed on demand) but for
// Google's OAuth2 + YouTube Data API v3 instead of TikTok's Login Kit.
const AUTOMATION_TOKEN_COLLECTION = 'youtube_automation_tokens';
const AUTOMATION_TOKEN_DOC = 'default';
const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

export function getYouTubeRedirectUri(req) {
  const configured = process.env.YOUTUBE_REDIRECT_URI;
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost:3000';
  const protocol = req?.headers?.['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');

  if (configured && configured.trim().startsWith('http')) {
    const configuredUri = configured.trim();
    const configuredIsLocal = configuredUri.includes('localhost') || configuredUri.includes('127.0.0.1');
    const requestIsLocal = String(host).includes('localhost') || String(host).includes('127.0.0.1');
    if (!configuredIsLocal || requestIsLocal) return configuredUri;
  }

  if (process.env.APP_URL) {
    return `${process.env.APP_URL.trim().replace(/\/$/, '')}/api/tiktok/callback?provider=youtube`;
  }

  return `${protocol}://${host}/api/tiktok/callback?provider=youtube`;
}

// access_type=offline + prompt=consent are both required to reliably get a
// refresh_token back -- Google otherwise only issues one on a user's very
// first-ever consent for this app, silently omitting it on any later
// reconnect, which would leave the stored automation connection with no way
// to refresh past its short-lived access token's ~1 hour expiry.
export function getYouTubeAuthUrl(req, state) {
  const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('YOUTUBE_CLIENT_ID is not configured');
  if (!state) throw new Error('An OAuth state value is required');

  const redirectUri = getYouTubeRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_UPLOAD_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeYouTubeCode(req, code) {
  const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET are not configured.');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: getYouTubeRedirectUri(req),
    }).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error || 'YouTube token exchange failed.');
  }
  return data;
}

export async function saveYouTubeAutomationTokens(db, { accessToken, refreshToken, expiresIn, channelId, channelTitle }) {
  const now = Date.now();
  await db.collection(AUTOMATION_TOKEN_COLLECTION).doc(AUTOMATION_TOKEN_DOC).set({
    accessToken,
    refreshToken: refreshToken || null,
    expiresAt: now + (Number(expiresIn) || 0) * 1000,
    channelId: channelId || null,
    channelTitle: channelTitle || null,
    updatedAt: FieldValue.serverTimestamp(),
    revoked: false,
    revokedAt: null,
  }, { merge: true });
}

// Same shared-connection pattern as getAutomationAccessToken in _tiktok.js:
// returns null (not a throw) when nothing has ever been connected, so cron
// callers can treat "not connected" as a normal, retryable state.
export async function getYouTubeAutomationAccessToken(db) {
  const ref = db.collection(AUTOMATION_TOKEN_COLLECTION).doc(AUTOMATION_TOKEN_DOC);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (data.revoked) return null;
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  if (data.accessToken && data.expiresAt && data.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return data.accessToken;
  }
  if (!data.refreshToken) return data.accessToken || null;

  const clientId = (process.env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET are not configured; cannot refresh the YouTube automation token.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: data.refreshToken,
    }).toString(),
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) {
    // Google stops honoring a refresh_token if the user revokes access from
    // their Google Account settings -- surface that as "not connected" the
    // same way a TikTok revocation does, instead of retrying forever.
    await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp() });
    throw new Error(refreshed?.error_description || refreshed?.error || 'YouTube token refresh failed.');
  }

  await saveYouTubeAutomationTokens(db, {
    accessToken: refreshed.access_token,
    refreshToken: data.refreshToken,
    expiresIn: refreshed.expires_in,
    channelId: data.channelId,
    channelTitle: data.channelTitle,
  });

  return refreshed.access_token;
}

// Multipart upload (metadata + video bytes in one request) rather than
// resumable -- these are short (<=8s) AI-generated clips, comfortably inside
// Vercel's request body limit, so the extra round trips a resumable session
// needs would only add latency and failure surface for no real benefit here.
export async function publishVideoToYouTube(accessToken, { videoBuffer, title, description, privacyStatus }) {
  const metadata = {
    snippet: {
      title: String(title || 'AI Generated Content').slice(0, 100),
      description: String(description || '').slice(0, 5000),
    },
    status: {
      privacyStatus: ['public', 'unlisted', 'private'].includes(privacyStatus) ? privacyStatus : 'public',
    },
  };
  const boundary = `youtube-upload-${Date.now()}`;
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const videoPartHeader = `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(metadataPart, 'utf8'),
    Buffer.from(videoPartHeader, 'utf8'),
    videoBuffer,
    Buffer.from(closing, 'utf8'),
  ]);

  const response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    const error = new Error(data?.error?.message || `YouTube upload returned HTTP ${response.status}`);
    error.status = response.status >= 400 ? response.status : 500;
    error.code = data?.error?.errors?.[0]?.reason || 'youtube_upload_failed';
    throw error;
  }
  return { videoId: data.id };
}
