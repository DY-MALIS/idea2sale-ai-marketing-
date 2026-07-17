export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();

  if (!token || !chatId) {
    return res.status(503).json({
      error: 'Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel.'
    });
  }

  const text = String(req.body?.text || '').trim();
  const mediaUrl = String(req.body?.mediaUrl || '').trim();
  const mediaDataUrl = String(req.body?.mediaDataUrl || '').trim();
  const mediaName = String(req.body?.mediaName || 'telegram-media').trim();
  const mediaType = String(req.body?.mediaType || '').trim().toLowerCase();

  if (!text && !mediaUrl && !mediaDataUrl) {
    return res.status(400).json({ error: 'Telegram text, image, or video is required.' });
  }

  try {
    const hasMedia = !!(mediaUrl || mediaDataUrl);
    const method = hasMedia
      ? mediaType === 'video'
        ? 'sendVideo'
        : 'sendPhoto'
      : 'sendMessage';

    let payload;
    let headers = { 'Content-Type': 'application/json' };

    if (mediaDataUrl) {
      const match = mediaDataUrl.match(/^data:([^;,]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid media data.' });
      }

      const contentType = match[1];
      const buffer = Buffer.from(match[2], 'base64');
      const form = new FormData();
      form.append('chat_id', chatId);
      if (text) form.append('caption', text);
      form.append(mediaType === 'video' ? 'video' : 'photo', new Blob([buffer], { type: contentType }), mediaName);
      payload = form;
      headers = undefined;
    } else {
      payload = mediaUrl
        ? {
            chat_id: chatId,
            [mediaType === 'video' ? 'video' : 'photo']: mediaUrl,
            caption: text || undefined
          }
        : {
            chat_id: chatId,
            text,
            disable_web_page_preview: false
          };
    }

    let telegramRes = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers,
      body: mediaDataUrl ? payload : JSON.stringify(payload)
    });

    let data = await telegramRes.json();

    if (mediaUrl && (!telegramRes.ok || !data.ok)) {
      telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          document: mediaUrl,
          caption: text || undefined
        })
      });
      data = await telegramRes.json();
    }

    if (!telegramRes.ok || !data.ok) {
      return res.status(502).json({
        error: data?.description || 'Telegram could not publish this message.'
      });
    }

    return res.status(200).json({
      ok: true,
      messageId: data.result?.message_id || null
    });
  } catch (error) {
    return res.status(500).json({
      error: error?.message || 'Telegram publish failed.'
    });
  }
}
