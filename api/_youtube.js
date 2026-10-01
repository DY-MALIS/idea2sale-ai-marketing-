import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { Client as QStashClient } from '@upstash/qstash';
import { getCookie, sessionCookieAttributes } from './_tiktok.js';
import { getScheduledCallbackBaseUrl } from './_callbackUrl.js';

// YouTube's OAuth + upload helpers, mirroring api/_tiktok.js's owner-scoped
// automation connection stored in Firestore, refreshed on demand, but for
// Google's OAuth2 + YouTube Data API v3 instead of TikTok's Login Kit.
const AUTOMATION_TOKEN_COLLECTION = 'youtube_automation_tokens';
const AUTOMATION_TOKEN_DOC = (ownerId) => {
  if (!ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) throw new Error('YouTube connection requires a signed-in owner.');
  return ownerId;
};
const OAUTH_OWNER_COOKIE = 'youtube_oauth_owner';
const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

export function youtubeOwnerCookieHeader(ownerId, state, req) {
  const secret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  if (!secret) throw new Error('YOUTUBE_CLIENT_SECRET is not configured.');
  const signature = crypto.createHmac('sha256', secret).update(`${state}:${ownerId}`).digest('hex');
  return `${OAUTH_OWNER_COOKIE}=${encodeURIComponent(`${AUTOMATION_TOKEN_DOC(ownerId)}.${signature}`)}; ${sessionCookieAttributes(req)}; Max-Age=600`;
}

export function readYouTubeOAuthOwner(req, res) {
  const value = getCookie(req, OAUTH_OWNER_COOKIE);
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(existing || [], `${OAUTH_OWNER_COOKIE}=; ${sessionCookieAttributes(req)}; Max-Age=0`));
  const [ownerId, signature] = value.split('.');
  const state = String(req.query?.state || '');
  const secret = (process.env.YOUTUBE_CLIENT_SECRET || '').trim();
  if (!ownerId || !signature || !state || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${state}:${ownerId}`).digest('hex');
  const supplied = Buffer.from(signature, 'hex');
  const actual = Buffer.from(expected, 'hex');
  return supplied.length === actual.length && crypto.timingSafeEqual(supplied, actual)
    ? AUTOMATION_TOKEN_DOC(ownerId) : null;
}

export async function scheduleYouTubeQStashDelivery(req, postId, scheduledDate) {
  const token = (process.env.QSTASH_TOKEN || '').trim();
  if (!token) return false;
  try {
    const client = new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
    await client.publishJSON({
      url: `${getScheduledCallbackBaseUrl()}/api/tiktok/publish?action=youtubeDeliver`,
      body: { postId },
      notBefore: Math.floor(scheduledDate.getTime() / 1000),
    });
    return true;
  } catch (error) {
    console.error('QStash YouTube scheduling failed:', error?.message || error);
    return false;
  }
}

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

export async function saveYouTubeAutomationTokens(db, { ownerId, accessToken, refreshToken, expiresIn, channelId, channelTitle }) {
  const now = Date.now();
  await db.collection(AUTOMATION_TOKEN_COLLECTION).doc(AUTOMATION_TOKEN_DOC(ownerId)).set({
    ownerId,
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

// Same owner-scoped connection pattern as getAutomationAccessToken in _tiktok.js:
// returns null (not a throw) when nothing has ever been connected, so cron
// callers can treat "not connected" as a normal, retryable state.
export async function getYouTubeAutomationAccessToken(db, ownerId) {
  const ref = db.collection(AUTOMATION_TOKEN_COLLECTION).doc(AUTOMATION_TOKEN_DOC(ownerId));
  const snap = await ref.get();
  if (!snap.exists) return null;

  const data = snap.data();
  if (data.revoked) return null;
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  if (data.accessToken && data.expiresAt && data.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return data.accessToken;
  }
  if (!data.refreshToken) return data.expiresAt > Date.now() ? data.accessToken || null : null;

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
    ownerId,
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
