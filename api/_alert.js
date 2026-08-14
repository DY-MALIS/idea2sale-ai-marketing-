// Best-effort alert to an admin's Telegram DM/group -- deliberately a *different*
// chat than TELEGRAM_CHAT_ID (the public storefront broadcast channel customers
// see); reusing that one would spam customers with internal error messages.
// Set TELEGRAM_ADMIN_CHAT_ID to opt in. Never throws: a failed alert must not
// mask or replace the original error it's reporting.
const ALERT_TEXT_LIMIT = 3500;

export async function notifyAdmins(message) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const adminChatId = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();

  if (!token || !adminChatId) {
    console.error('[admin-alert]', message);
    return;
  }

  try {
    const text = String(message).slice(0, ALERT_TEXT_LIMIT);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: adminChatId, text: `⚠️ ${text}` }),
    });
  } catch (error) {
    console.error('Failed to send admin alert:', error?.message || error);
  }
}
