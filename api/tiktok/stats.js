function getCookie(req, name) {
  const match = String(req.headers.cookie || '').split(';').find((item) => item.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.trim().slice(name.length + 1)) : '';
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
    followers: numberFromEnv('TIKTOK_PUBLIC_FOLLOWERS', isDefaultHandle ? 3 : 0),
    following: numberFromEnv('TIKTOK_PUBLIC_FOLLOWING', isDefaultHandle ? 0 : 0),
    likes: numberFromEnv('TIKTOK_PUBLIC_LIKES', isDefaultHandle ? 197 : 0),
    videoCount: numberFromEnv('TIKTOK_PUBLIC_VIDEO_COUNT', isDefaultHandle ? 0 : 0),
    canReadStats: false,
    updatedAt: new Date().toISOString(),
    source: 'configured_public_fallback',
    message,
  };
}

export default async function handler(req, res) {
  const token = getCookie(req, 'tiktok_token');
  if (!token) return res.status(200).json(fallbackStats(req, 'Connect TikTok to read official account statistics.'));
  const scopes = String(process.env.TIKTOK_SCOPES || 'user.info.basic')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  const canReadStats = scopes.includes('user.info.stats');
  if (!canReadStats) {
    return res.status(200).json(fallbackStats(req, 'TikTok must approve user.info.stats before official statistics can be read.'));
  }
  const fields = canReadStats
    ? 'open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count'
    : 'open_id,avatar_url,display_name,username';
  try {
    const response = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || payload?.error?.code !== 'ok') {
      const code = payload?.error?.code || 'tiktok_error';
      const needsStats = /scope|permission|access/i.test(`${code} ${payload?.error?.message || ''}`);
      if (needsStats) return res.status(200).json(fallbackStats(req, 'TikTok must approve user.info.stats, then reconnect the account.'));
      return res.status(response.status || 400).json({ error: payload?.error?.message || 'TikTok could not return account statistics.', code });
    }
    const user = payload.data?.user || {};
    return res.status(200).json({
      handle: user.username || user.display_name || '', displayName: user.display_name || '', avatarUrl: user.avatar_url || '',
      followers: user.follower_count ?? null, following: user.following_count ?? null, likes: user.likes_count ?? null,
      videoCount: user.video_count ?? null, canReadStats, updatedAt: new Date().toISOString(), source: 'tiktok_official_api',
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch TikTok statistics.' });
  }
}
