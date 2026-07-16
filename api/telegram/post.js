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

  if (!text) {
    return res.status(400).json({ error: 'Telegram message text is required.' });
  }

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: false
      })
    });

    const data = await telegramRes.json();

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
