import { getCookie } from '../_tiktok.js';
import admin from 'firebase-admin';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';

async function requireSignedInUser(req) {
  initFirebaseAdmin();
  const authorization = String(req.headers.authorization || '');
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!idToken) return null;
  try {
    return await admin.auth().verifyIdToken(idToken, true);
  } catch {
    return null;
  }
}

function cleanHandle(value = '') {
  let handle = String(value || '').trim();
  if (handle.includes('tiktok.com/@')) handle = handle.split('tiktok.com/@')[1] || handle;
  handle = handle.split('?')[0].split('/')[0].replace(/^@/, '').trim();
  return handle || process.env.TIKTOK_PUBLIC_HANDLE || 'ai.cafe4';
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function fallbackStats(req, message = 'TikTok official statistics are not available yet.') {
  const handle = cleanHandle(req.query?.handle);
  const isDefaultHandle = handle.toLowerCase() === 'ai.cafe4';
  return {
    handle,
    displayName: handle,
    avatarUrl: '',
    bio: '',
    isVerified: false,
    profileDeepLink: '',
    followers: numberFromEnv('TIKTOK_PUBLIC_FOLLOWERS', isDefaultHandle ? 3 : 0),
    following: numberFromEnv('TIKTOK_PUBLIC_FOLLOWING', 0),
    likes: numberFromEnv('TIKTOK_PUBLIC_LIKES', isDefaultHandle ? 197 : 0),
    videoCount: numberFromEnv('TIKTOK_PUBLIC_VIDEO_COUNT', 0),
    canReadStats: false,
    updatedAt: new Date().toISOString(),
    source: 'configured_public_fallback',
    message,
  };
}

// TikTok's Display API (video.list, see developers.tiktok.com/doc/tiktok-api-v2-video-list)
// -- surfaces the connected account's own recent videos inside TikTok Analytics,
// distinct from "Recent TikTok Syncs" below which only reflects our own Firestore
// records of posts *this app* delivered, not what's actually live on TikTok.
async function handleVideoList(req, res) {
  const user = await requireSignedInUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to view TikTok videos.', code: 'auth_required' });

  const token = getCookie(req, 'tiktok_token');
  if (!token) return res.status(200).json({ videos: [], canReadVideos: false, message: 'Connect TikTok to read your recent videos.' });

  const fields = 'id,cover_image_url,title,share_url,view_count,create_time';
  try {
    const response = await fetch(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_count: 10 }),
    });
    const payload = await response.json();
    if (!response.ok || payload?.error?.code !== 'ok') {
      const code = payload?.error?.code || 'tiktok_error';
      const needsScope = /scope|permission|access/i.test(`${code} ${payload?.error?.message || ''}`);
      if (needsScope) return res.status(200).json({ videos: [], canReadVideos: false, message: 'TikTok must approve video.list, then reconnect the account.' });
      return res.status(response.status || 400).json({ error: payload?.error?.message || 'TikTok could not return your videos.', code });
    }
    const videos = (payload.data?.videos || []).map((video) => ({
      id: video.id,
      coverImageUrl: video.cover_image_url || '',
      title: video.title || '',
      shareUrl: video.share_url || '',
      viewCount: video.view_count ?? null,
      createTime: video.create_time ? video.create_time * 1000 : null,
    }));
    return res.status(200).json({ videos, canReadVideos: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch TikTok videos.' });
  }
}

export default async function handler(req, res) {
  if (req.query?.action === 'videos') return handleVideoList(req, res);

  const user = await requireSignedInUser(req);
  if (!user) return res.status(401).json({ error: 'Sign in to view TikTok statistics.', code: 'auth_required' });

  const token = getCookie(req, 'tiktok_token');
  if (!token) return res.status(200).json(fallbackStats(req, 'Connect TikTok to read official account statistics.'));
  const fields = 'open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count,bio_description,is_verified,profile_deep_link';
  try {
    const response = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || payload?.error?.code !== 'ok') {
      const code = payload?.error?.code || 'tiktok_error';
      const needsStats = /scope|permission|access/i.test(`${code} ${payload?.error?.message || ''}`);
      if (needsStats) return res.status(200).json(fallbackStats(req, 'TikTok must approve user.info.stats and user.info.profile, then reconnect the account.'));
      return res.status(response.status || 400).json({ error: payload?.error?.message || 'TikTok could not return account statistics.', code });
    }
    const user = payload.data?.user || {};
    return res.status(200).json({
      handle: user.username || user.display_name || '', displayName: user.display_name || '', avatarUrl: user.avatar_url || '',
      bio: user.bio_description || '', isVerified: !!user.is_verified, profileDeepLink: user.profile_deep_link || '',
      followers: user.follower_count ?? null, following: user.following_count ?? null, likes: user.likes_count ?? null,
      videoCount: user.video_count ?? null, canReadStats: true, updatedAt: new Date().toISOString(), source: 'tiktok_official_api',
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch TikTok statistics.' });
  }
}
