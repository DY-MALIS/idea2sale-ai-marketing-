function getCookie(req, name) {
  const match = String(req.headers.cookie || '').split(';').find((item) => item.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.trim().slice(name.length + 1)) : '';
}

export default async function handler(req, res) {
  const token = getCookie(req, 'tiktok_token');
  if (!token) return res.status(401).json({ error: 'Connect your TikTok account first.', code: 'not_connected' });
  const scopes = String(process.env.TIKTOK_SCOPES || 'user.info.basic')
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
  const canReadStats = scopes.includes('user.info.stats');
  const fields = canReadStats
    ? 'open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count'
    : 'open_id,avatar_url,display_name,username';
  try {
    const response = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || payload?.error?.code !== 'ok') {
      const code = payload?.error?.code || 'tiktok_error';
      const needsStats = /scope|permission|access/i.test(`${code} ${payload?.error?.message || ''}`);
      return res.status(response.status || 400).json({ error: needsStats ? 'TikTok must approve user.info.stats, then reconnect the account.' : (payload?.error?.message || 'TikTok could not return account statistics.'), code });
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
