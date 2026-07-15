function getCookie(req, name) {
  return (req.headers.cookie || '')
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split('=')
    .slice(1)
    .join('=') || '';
}

function videoFromDataUrl(videoUrl) {
  const match = String(videoUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = match[1] || 'video/mp4';
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(mimeType)) {
    throw new Error('TikTok accepts MP4, MOV, or WebM videos only.');
  }

  return {
    mimeType,
    buffer: Buffer.from(match[2], 'base64'),
  };
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

async function uploadVideo(uploadUrl, token, video) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': video.mimeType,
      'Content-Length': String(video.buffer.length),
      'Content-Range': `bytes 0-${video.buffer.length - 1}/${video.buffer.length}`,
    },
    body: video.buffer,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(detail || `TikTok upload failed with ${response.status}`);
  }
}

function publicUrlRequest(videoUrl) {
  return /^https:\/\//i.test(String(videoUrl || ''));
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
    const videoUrl = String(req.body?.videoUrl || '');
    const title = String(req.body?.title || 'AI Generated Content').slice(0, 2200);
    const postMode = String(process.env.TIKTOK_POST_MODE || 'inbox').toLowerCase();
    const directPost = postMode === 'direct';
    const endpoint = directPost
      ? 'https://open.tiktokapis.com/v2/post/publish/video/init/'
      : 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';

    const sourceInfo = publicUrlRequest(videoUrl)
      ? { source: 'PULL_FROM_URL', video_url: videoUrl }
      : null;
    const video = sourceInfo ? null : videoFromDataUrl(videoUrl);

    if (!sourceInfo && !video) {
      return res.status(400).json({
        error: {
          message: 'Generated video is missing or is not a valid MP4/MOV/WebM data URL.',
          code: 'invalid_video',
        },
      });
    }

    const fileSourceInfo = video
      ? {
          source: 'FILE_UPLOAD',
          video_size: video.buffer.length,
          chunk_size: video.buffer.length,
          total_chunk_count: 1,
        }
      : sourceInfo;

    const body = directPost
      ? {
          post_info: {
            title,
            privacy_level: process.env.TIKTOK_PRIVACY_LEVEL || 'SELF_ONLY',
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            brand_content_toggle: false,
            brand_organic_toggle: true,
            is_aigc: true,
          },
          source_info: fileSourceInfo,
        }
      : { source_info: fileSourceInfo };

    const initData = await tiktokJson(endpoint, token, body);
    const publishId = initData?.data?.publish_id;
    const uploadUrl = initData?.data?.upload_url;

    if (video && uploadUrl) {
      await uploadVideo(uploadUrl, token, video);
    }

    return res.status(200).json({
      success: true,
      publishId,
      mode: directPost ? 'direct' : 'inbox',
      message: directPost
        ? 'Video sent to TikTok for direct posting.'
        : 'Video uploaded to TikTok. Open your TikTok inbox/notification to finish editing and post.',
    });
  } catch (error) {
    const code = error.code || 'publish_failed';
    const status = error.status || (/scope/i.test(error.message || '') ? 401 : 500);
    return res.status(status).json({
      error: {
        message: error.message || 'TikTok publishing failed.',
        code,
      },
    });
  }
}
