import { createHash } from 'crypto';
import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { logAudit } from '../_audit.js';
import { getCookie } from '../_tiktok.js';

// Best-effort: TikTok publishing is authenticated via the tiktok_token cookie
// (one shared TikTok connection for the app), not Firebase Auth, so there is
// no uid to require here. If the caller is signed in to Firebase we still
// attach their uid to the audit log; if not, the log just has no actor.
async function resolveActorUid(req) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

const getCloudinaryConfig = () => {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).');
  }
  return { cloudName, apiKey, apiSecret };
};

async function uploadImageDataUrlToCloudinary(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Generated poster is missing or is not a valid image data URL.');
  }

  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'tiktok-photo-posts';
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(paramsToSign + apiSecret).digest('hex');

  const form = new URLSearchParams();
  form.set('file', imageDataUrl);
  form.set('api_key', apiKey);
  form.set('timestamp', String(timestamp));
  form.set('signature', signature);
  form.set('folder', folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Cloudinary upload failed.');
  }

  return data.secure_url;
}

async function tiktokJson(url, token, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  const apiError = data?.error;
  if (!response.ok || (apiError?.code && apiError.code !== 'ok')) {
    const message = apiError?.message || data?.message || `TikTok request failed with ${response.status}`;
    const code = apiError?.code || data?.code || 'tiktok_error';
    const error = new Error(message);
    error.status = response.status || 500;
    error.code = code;
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const token = getCookie(req, 'tiktok_token');
  if (!token) {
    return res.status(401).json({
      error: {
        message: 'Please reconnect TikTok after adding video.upload/video.publish to TIKTOK_SCOPES.',
        code: 'not_authenticated',
      },
    });
  }

  try {
    const imageDataUrl = String(req.body?.imageDataUrl || '');
    const imageUrl = String(req.body?.imageUrl || '');
    const title = String(req.body?.title || 'AI Generated Poster').slice(0, 90);

    const photoUrl = /^https:\/\//i.test(imageUrl)
      ? imageUrl
      : await uploadImageDataUrlToCloudinary(imageDataUrl);

    if (!photoUrl) {
      return res.status(400).json({
        error: {
          message: 'Generated poster is missing or could not be uploaded.',
          code: 'invalid_image',
        },
      });
    }

    const postMode = String(process.env.TIKTOK_POST_MODE || 'inbox').toLowerCase();
    const directPost = postMode === 'direct';

    const postInfo = directPost
      ? {
          title,
          privacy_level: process.env.TIKTOK_PRIVACY_LEVEL || 'SELF_ONLY',
          disable_comment: false,
          auto_add_music: true,
          brand_content_toggle: false,
          brand_organic_toggle: true,
        }
      : { title };

    const body = {
      media_type: 'PHOTO',
      post_mode: directPost ? 'DIRECT_POST' : 'MEDIA_UPLOAD',
      post_info: postInfo,
      source_info: {
        source: 'PULL_FROM_URL',
        photo_images: [photoUrl],
        photo_cover_index: 0,
      },
    };

    const initData = await tiktokJson('https://open.tiktokapis.com/v2/post/publish/content/init/', token, body);
    const publishId = initData?.data?.publish_id;

    try {
      const actorUid = await resolveActorUid(req);
      const db = initFirebaseAdmin();
      await logAudit(db, {
        action: 'tiktok_publish_photo',
        actorUid,
        meta: { publishId, mode: directPost ? 'direct' : 'inbox' },
      });
    } catch (auditError) {
      console.error('Audit log failed for tiktok_publish_photo:', auditError?.message || auditError);
    }

    return res.status(200).json({
      success: true,
      publishId,
      mode: directPost ? 'direct' : 'inbox',
      message: directPost
        ? 'Poster sent to TikTok for direct posting.'
        : 'Poster uploaded to TikTok. Open your TikTok inbox/notification to finish editing and post.',
    });
  } catch (error) {
    const code = error.code || 'publish_failed';
    const status = error.status || (/scope/i.test(error.message || '') ? 401 : 500);
    return res.status(status).json({
      error: {
        message: error.message || 'TikTok photo publishing failed.',
        code,
      },
    });
  }
}
