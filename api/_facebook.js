import crypto from 'crypto';
import { Client as QStashClient } from '@upstash/qstash';
import { getCookie, sessionCookieAttributes } from './_tiktok.js';
import { getScheduledCallbackBaseUrl } from './_callbackUrl.js';
import { extractWebsiteText } from './_websiteExtract.js';
import { facebookBusinessPageKey } from './_socialUrls.js';

const COLLECTION = 'facebook_automation_tokens';
const VERSION = process.env.FACEBOOK_GRAPH_API_VERSION || 'v25.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const OWNER_COOKIE = 'facebook_oauth_owner';
const STATE_COOKIE = 'facebook_oauth_state';

function appCredentials() {
  const appId = (process.env.FACEBOOK_APP_ID || '').trim();
  const appSecret = (process.env.FACEBOOK_APP_SECRET || '').trim();
  if (!appId || !appSecret) throw new Error('FACEBOOK_APP_ID and FACEBOOK_APP_SECRET are not configured.');
  return { appId, appSecret };
}

export function facebookRedirectUri() {
  const base = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (!base || !/^https?:\/\//.test(base)) throw new Error('APP_URL must be configured to connect Facebook.');
  return `${base}/api/tiktok/callback?provider=facebook`;
}

export function facebookAuthUrl(state) {
  const { appId } = appCredentials();
  const configId = (process.env.FACEBOOK_CONFIG_ID || '').trim();
  if (!configId) throw new Error('FACEBOOK_CONFIG_ID is not configured.');
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: facebookRedirectUri(),
    response_type: 'code',
    config_id: configId,
    override_default_response_type: 'true',
    state,
  });
  return `https://www.facebook.com/${VERSION}/dialog/oauth?${params}`;
}

export function facebookAuthCookies(ownerId, state, req) {
  const { appSecret } = appCredentials();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)) throw new Error('Invalid owner.');
  const signature = crypto.createHmac('sha256', appSecret).update(`${state}:${ownerId}`).digest('hex');
  const attributes = sessionCookieAttributes(req);
  return [
    `${STATE_COOKIE}=${state}; ${attributes}; Max-Age=600`,
    `${OWNER_COOKIE}=${encodeURIComponent(`${ownerId}.${signature}`)}; ${attributes}; Max-Age=600`,
  ];
}

export function readFacebookOAuthOwner(req, res) {
  const state = String(req.query?.state || '');
  const cookieState = getCookie(req, STATE_COOKIE);
  const value = getCookie(req, OWNER_COOKIE);
  const attributes = sessionCookieAttributes(req);
  res.setHeader('Set-Cookie', [].concat(res.getHeader('Set-Cookie') || [], [
    `${STATE_COOKIE}=; ${attributes}; Max-Age=0`,
    `${OWNER_COOKIE}=; ${attributes}; Max-Age=0`,
  ]));
  const [ownerId, signature] = value.split('.');
  if (!state || cookieState !== state || !ownerId || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId) || !/^[a-f0-9]{64}$/.test(signature || '')) return null;
  const { appSecret } = appCredentials();
  const expected = crypto.createHmac('sha256', appSecret).update(`${state}:${ownerId}`).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')) ? ownerId : null;
}

async function graphJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `Facebook returned HTTP ${response.status}`);
    error.code = data.error?.code || 'facebook_api_error';
    throw error;
  }
  return data;
}

export async function exchangeFacebookCode(code) {
  const { appId, appSecret } = appCredentials();
  const shortToken = await graphJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: facebookRedirectUri(), code })}`);
  const longToken = await graphJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken.access_token })}`);
  const pages = await graphJson(`${GRAPH}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,tasks', limit: '100', access_token: longToken.access_token })}`);
  return (pages.data || []).filter(page => page.id && page.access_token && (page.tasks || []).some(task => task === 'CREATE_CONTENT' || task === 'PROFILE_PLUS_CREATE_CONTENT' || task === 'MANAGE' || task === 'PROFILE_PLUS_FULL_CONTROL'));
}

export async function saveFacebookPages(db, ownerId, pages) {
  const ref = db.collection(COLLECTION).doc(ownerId);
  const old = await ref.get();
  const selectedPageId = pages.some(page => page.id === old.data()?.selectedPageId) ? old.data().selectedPageId : pages[0]?.id;
  await ref.set({ ownerId, pages: pages.map(page => ({ id: page.id, name: page.name, accessToken: page.access_token })), selectedPageId, updatedAt: Date.now() });
}

export async function getFacebookPages(db, ownerId) {
  const snapshot = await db.collection(COLLECTION).doc(ownerId).get();
  return snapshot.exists ? snapshot.data() : null;
}

export async function readConnectedFacebookPage(db, ownerId) {
  const connection = await getFacebookPages(db, ownerId);
  const page = connection?.pages?.find((item) => item.id === connection.selectedPageId) || connection?.pages?.[0];
  if (!page?.id || !page?.accessToken) {
    throw Object.assign(new Error('Connect your Facebook Page in Social Automation first.'), { status: 409 });
  }
  const headers = { Authorization: `Bearer ${page.accessToken}` };
  const read = async (path, params) => {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(page.id)}${path}?${new URLSearchParams(params)}`, {
      headers, signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) throw new Error(body.error?.message || `Facebook returned HTTP ${response.status}`);
    return body;
  };
  const [details, posts] = await Promise.allSettled([
    read('', { fields: 'id,name,about,description,website,phone,link' }),
    read('/posts', { fields: 'message,created_time,permalink_url', limit: '20' }),
  ]);
  if (details.status === 'rejected' && posts.status === 'rejected') {
    throw Object.assign(new Error('Facebook did not allow this Page data to be read. Reconnect the Page and check Page read permissions.'), { status: 502 });
  }
  const info = details.status === 'fulfilled' ? details.value : {};
  return {
    pageName: String(info.name || page.name || '').slice(0, 180),
    pageUrl: String(info.link || '').slice(0, 300),
    about: String(info.about || info.description || '').slice(0, 1500),
    website: String(info.website || '').slice(0, 300),
    phone: String(info.phone || '').slice(0, 100),
    posts: posts.status === 'fulfilled' ? (posts.value.data || []).slice(0, 20).map((post) => ({
      text: String(post.message || '').slice(0, 1500),
      publishedAt: String(post.created_time || ''),
      url: String(post.permalink_url || '').slice(0, 300),
    })) : [],
    postsReadable: posts.status === 'fulfilled',
    source: 'Connected Facebook Page (Graph API)',
  };
}

export async function readProfileFacebookPage(db, ownerId, { extract = extractWebsiteText, readConnected = readConnectedFacebookPage } = {}) {
  const profileSnapshot = await db.collection('business_profiles').doc(ownerId).get();
  const savedUrl = String(profileSnapshot.data()?.facebookPageUrl || '').trim().slice(0, 300);
  const savedKey = facebookBusinessPageKey(savedUrl);
  if (!savedKey) {
    if (savedUrl) throw Object.assign(new Error('Save a valid public Facebook Page link in Business Profile.'), { status: 400 });
    return readConnected(db, ownerId);
  }

  // A connection is useful only when its Graph Page matches this account's
  // saved profile link. Never return a different selected Page as evidence.
  try {
    const connected = await readConnected(db, ownerId);
    const connectedKey = facebookBusinessPageKey(connected.pageUrl);
    if (connectedKey && connectedKey === savedKey) return { ...connected, profilePageUrl: savedUrl };
  } catch { /* A public Page may still be readable without a connection. */ }

  let page;
  try {
    page = await extract({ url: savedUrl });
  } catch {
    throw Object.assign(new Error('Could not read the Facebook Page saved in Business Profile. Facebook may require login; connect that Page in Social Automation to read its current posts.'), { status: 502 });
  }
  const finalKey = facebookBusinessPageKey(page.url);
  const content = String(page.text || '').replace(/\s+/g, ' ').trim();
  const title = String(page.title || '').trim();
  const loginWall = /(?:facebook.*(?:log in|sign up)|(?:log in|sign up).*facebook|ចូលគណនី.*facebook)/i.test(title)
    || (content.length < 500 && /(?:log in to facebook|log into facebook|you must log in|បង្កើតគណនីថ្មី)/i.test(content));
  if (finalKey !== savedKey || content.length < (page.metadataOnly ? 40 : 80) || loginWall) {
    throw Object.assign(new Error('Facebook did not expose readable Page content at the saved Profile link. Connect this Page in Social Automation to read its current posts.'), { status: 502 });
  }
  return {
    pageName: title.slice(0, 180),
    pageUrl: savedUrl,
    text: content.slice(0, 12000),
    posts: [],
    postsReadable: false,
    source: page.metadataOnly ? 'Public Facebook Page description saved in Business Profile (posts unavailable)' : 'Public Facebook Page saved in Business Profile',
  };
}

export async function publishFacebookReel(pageToken, videoUrl, caption) {
  if (!/^https:\/\//.test(videoUrl || '')) throw new Error('Facebook needs a publicly accessible HTTPS video URL.');
  const start = await graphJson(`${GRAPH}/me/video_reels?${new URLSearchParams({ access_token: pageToken, upload_phase: 'start' })}`, { method: 'POST' });
  if (!start.video_id || !/^\d+$/.test(String(start.video_id))) throw new Error('Facebook did not create a Reel upload.');
  const upload = await graphJson(`https://rupload.facebook.com/video-upload/${VERSION}/${start.video_id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${pageToken}`, file_url: videoUrl },
  });
  if (upload.success !== true) throw new Error('Facebook did not accept the video.');
  const finish = await graphJson(`${GRAPH}/me/video_reels?${new URLSearchParams({ access_token: pageToken, video_id: String(start.video_id), upload_phase: 'finish', video_state: 'PUBLISHED', description: String(caption || '').slice(0, 5000) })}`, { method: 'POST' });
  if (finish.success !== true) throw new Error('Facebook did not accept the publish request.');
  return String(start.video_id);
}

export async function publishFacebookPhoto(pageToken, pageId, imageUrl, caption) {
  if (!/^\d+$/.test(String(pageId || '')) || !/^https:\/\//.test(imageUrl || '')) {
    throw new Error('Facebook needs a connected Page and a publicly accessible HTTPS image URL.');
  }
  const result = await graphJson(`${GRAPH}/${pageId}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: pageToken, url: imageUrl, message: String(caption || '').slice(0, 5000), published: 'true' }),
  });
  if (!result.id) throw new Error('Facebook did not return a photo ID.');
  return String(result.id);
}

export async function getFacebookReelStatus(pageToken, videoId) {
  return graphJson(`${GRAPH}/${encodeURIComponent(videoId)}?${new URLSearchParams({ fields: 'status', access_token: pageToken })}`);
}

export async function scheduleFacebookQStashDelivery(postId, scheduledDate) {
  const token = (process.env.QSTASH_TOKEN || '').trim();
  if (!token) return false;
  try {
    const client = new QStashClient({ token, baseUrl: process.env.QSTASH_URL });
    await client.publishJSON({
      url: `${getScheduledCallbackBaseUrl()}/api/tiktok/publish?action=facebookDeliver`,
      body: { postId },
      notBefore: Math.floor(scheduledDate.getTime() / 1000),
    });
    return true;
  } catch (error) {
    console.error('QStash Facebook scheduling failed:', error?.message || error);
    return false;
  }
}
