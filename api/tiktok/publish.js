export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(403).json({
    error: {
      message: 'TikTok direct posting is not enabled yet. Ask TikTok to approve Content Posting API and video.upload/video.publish before using auto-post.',
      code: 'posting_not_approved',
    },
  });
}
