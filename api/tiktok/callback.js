import { getRedirectUri } from '../_tiktok.js';

export default async function handler(req, res) {
  const code = req.query?.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  const clientKey = (process.env.TIKTOK_CLIENT_KEY || process.env.VITE_TIKTOK_CLIENT_KEY || '').trim();
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || process.env.VITE_TIKTOK_CLIENT_SECRET || '').trim();

  if (!clientKey || !clientSecret) {
    return res.status(500).send('TikTok credentials are not configured');
  }

  try {
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: getRedirectUri(req),
      }).toString(),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(500).send(`TikTok token exchange failed: ${data?.error_description || data?.error || 'Unknown error'}`);
    }

    const token = data.access_token || '';
    res.setHeader('Set-Cookie', `tiktok_token=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${data.expires_in || 86400}`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
      <!doctype html>
      <html>
        <body>
          <h1>TikTok connected</h1>
          <p>You can close this window and return to aime.angkorgate.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'TIKTOK_AUTH_SUCCESS' }, '*');
              window.close();
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(error.message || 'Failed to exchange TikTok code');
  }
}
