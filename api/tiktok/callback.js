import { getRedirectUri, verifyAndClearOAuthState, saveAutomationTokens } from '../_tiktok.js';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';

export default async function handler(req, res) {
  const code = req.query?.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  // Anti-CSRF check: without this, anyone who obtains a `code` from their own
  // TikTok OAuth attempt (their own account) could get a victim's browser to
  // exchange it here just by opening this callback URL with that code attached
  // -- the victim's tiktok_token cookie would silently end up authenticated as
  // the attacker's TikTok account instead of their own.
  if (!verifyAndClearOAuthState(req, res)) {
    return res.status(400).send('Invalid or expired TikTok login attempt. Please try connecting again.');
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

    // Best-effort: persists the refresh token so the cron auto-publisher
    // (api/tiktok/publish.js's ?action=cron) can keep posting scheduled TikTok
    // content after this cookie expires -- must never block the connect flow
    // below from completing, since that's what the user is actually waiting on.
    try {
      const db = initFirebaseAdmin();
      await saveAutomationTokens(db, {
        accessToken: token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        refreshExpiresIn: data.refresh_expires_in,
        openId: data.open_id,
      });
    } catch (persistError) {
      console.error('Failed to persist TikTok automation tokens:', persistError?.message || persistError);
    }

    // Append, don't replace -- verifyAndClearOAuthState above already queued the
    // state cookie's clearing header, and setHeader() overwrites rather than adds.
    const existingSetCookie = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [].concat(
      existingSetCookie || [],
      `tiktok_token=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${data.expires_in || 86400}`,
    ));
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
