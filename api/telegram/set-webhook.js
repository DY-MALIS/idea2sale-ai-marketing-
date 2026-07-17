const getBaseUrl = (req) => {
  const configured = (process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (configured) return configured.startsWith('http') ? configured.replace(/\/$/, '') : `https://${configured.replace(/\/$/, '')}`;

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'aime.angkorgate.ai';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`.replace(/\/$/, '');
};

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not configured in Vercel.' });
  }

  const setupKey = (process.env.TELEGRAM_WEBHOOK_SETUP_KEY || '').trim();
  if (setupKey && req.query?.key !== setupKey) {
    return res.status(401).json({ error: 'Invalid setup key.' });
  }

  const baseUrl = getBaseUrl(req);
  const webhookUrl = `${baseUrl}/api/telegram/webhook`;
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  const payload = {
    url: webhookUrl,
    allowed_updates: ['message', 'edited_message'],
    drop_pending_updates: false,
    ...(secret ? { secret_token: secret } : {}),
  };

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return res.status(502).json({
        ok: false,
        webhookUrl,
        error: data?.description || 'Telegram setWebhook failed.',
      });
    }

    return res.status(200).json({
      ok: true,
      webhookUrl,
      message: 'Telegram chatbot webhook is active. Send /start to your bot in Telegram.',
      telegram: data,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      webhookUrl,
      error: error?.message || 'Telegram webhook setup failed.',
    });
  }
}
