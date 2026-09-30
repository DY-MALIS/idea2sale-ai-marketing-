import { getRedirectUri, sessionCookieAttributes, verifyAndClearOAuthState, readOAuthOwner, saveAutomationTokens } from '../_tiktok.js';
import { getYouTubeRedirectUri, exchangeYouTubeCode, saveYouTubeAutomationTokens } from '../_youtube.js';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';

// Also handles YouTube's OAuth callback (?provider=youtube, matching the
// redirect_uri getYouTubeRedirectUri registers) -- folded into this file
// instead of a new api/youtube/callback.js for the same Vercel Hobby
// 12-function-cap reason documented in api/tiktok/publish.js.
async function handleYouTubeCallback(req, res, code) {
  if (!verifyAndClearOAuthState(req, res)) {
    return res.status(400).send('Invalid or expired YouTube login attempt. Please try connecting again.');
  }
  try {
    const data = await exchangeYouTubeCode(req, String(code));
    let channelId = null;
    let channelTitle = null;
    try {
      const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      const channelData = await channelResponse.json().catch(() => ({}));
      const channel = channelData?.items?.[0];
      channelId = channel?.id || null;
      channelTitle = channel?.snippet?.title || null;
    } catch (channelError) {
      console.error('Failed to fetch YouTube channel info:', channelError?.message || channelError);
    }

    try {
      const db = initFirebaseAdmin();
      await saveYouTubeAutomationTokens(db, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        channelId,
        channelTitle,
      });
    } catch (persistError) {
      console.error('Failed to persist YouTube automation tokens:', persistError?.message || persistError);
    }

    const openerOrigin = new URL(getYouTubeRedirectUri(req)).origin;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`
      <!doctype html>
      <html>
        <body>
          <h1>YouTube connected${channelTitle ? ` (${channelTitle})` : ''}</h1>
          <p>You can close this window and return to aime.angkorgate.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'YOUTUBE_AUTH_SUCCESS' }, ${JSON.stringify(openerOrigin)});
              window.close();
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    return res.status(500).send(error.message || 'Failed to exchange YouTube code');
  }
}

export default async function handler(req, res) {
  const code = req.query?.code;
  if (!code) {
    return res.status(400).send('No code provided');
  }

  if (String(req.query?.provider || '').toLowerCase() === 'youtube') {
    return handleYouTubeCallback(req, res, code);
  }

  // Anti-CSRF check: without this, anyone who obtains a `code` from their own
  // TikTok OAuth attempt (their own account) could get a victim's browser to
  // exchange it here just by opening this callback URL with that code attached
  // -- the victim's tiktok_token cookie would silently end up authenticated as
  // the attacker's TikTok account instead of their own.
  if (!verifyAndClearOAuthState(req, res)) {
    return res.status(400).send('Invalid or expired TikTok login attempt. Please try connecting again.');
  }
  const ownerId = readOAuthOwner(req, res);
  if (!ownerId) return res.status(400).send('TikTok connection is not linked to a signed-in profile. Please connect again.');

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

    // The browser connection and scheduled publisher must identify the same
    // owner. Do not report success if this owner's token could not be saved.
    const db = initFirebaseAdmin();
    await saveAutomationTokens(db, {
      ownerId,
      accessToken: token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      refreshExpiresIn: data.refresh_expires_in,
      openId: data.open_id,
    });

    // Append, don't replace -- verifyAndClearOAuthState above already queued the
    // state cookie's clearing header, and setHeader() overwrites rather than adds.
    const existingSetCookie = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [].concat(
      existingSetCookie || [],
      `tiktok_token=${token}; ${sessionCookieAttributes(req)}; Max-Age=${data.expires_in || 86400}`,
      `tiktok_owner=${encodeURIComponent(ownerId)}; ${sessionCookieAttributes(req)}; Max-Age=${data.expires_in || 86400}`,
    ));
    const openerOrigin = new URL(getRedirectUri(req)).origin;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`
      <!doctype html>
      <html>
        <body>
          <h1>TikTok connected</h1>
          <p>You can close this window and return to aime.angkorgate.</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'TIKTOK_AUTH_SUCCESS' }, ${JSON.stringify(openerOrigin)});
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
