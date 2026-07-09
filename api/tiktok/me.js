function getCookie(req, name) {
  const match = String(req.headers.cookie || '').split(';').find((item) => item.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.trim().slice(name.length + 1)) : '';
}

export default async function handler(req, res) {
  const token = getCookie(req, 'tiktok_token');
  if (!token) return res.status(401).json({ error: 'Not connected to TikTok', code: 'not_connected' });

  try {
    const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json();

    if (!response.ok || payload?.error?.code !== 'ok') {
      return res.status(response.status || 400).json({
        error: payload?.error?.message || 'Failed to fetch TikTok user info',
        code: payload?.error?.code || 'tiktok_error',
      });
    }

    const user = payload.data?.user || {};
    return res.status(200).json({
      open_id: user.open_id || '',
      avatar_url: user.avatar_url || '',
      display_name: user.display_name || user.username || 'TikTok user',
      username: user.username || '',
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to fetch TikTok user info' });
  }
}
