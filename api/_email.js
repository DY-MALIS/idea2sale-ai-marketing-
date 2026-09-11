// Resend chosen over SMTP/SendGrid/SES: a single REST call (no SDK dependency
// to install), a generous free tier, and a shared onboarding@resend.dev
// sender that works immediately for testing before the business verifies
// their own domain -- lowest setup friction for a small Cambodian business
// owner who has never configured transactional email before.
const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendOutreachEmail({ to, subject, body, fromName }) {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('Email sending is not configured yet (RESEND_API_KEY is missing).');

  const fromAddress = (process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev').trim();
  const from = fromName ? `${fromName} <${fromAddress}>` : fromAddress;

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      // Outreach messages are plain conversational text (often Khmer), not
      // HTML marketing copy -- text-only avoids Resend/inbox providers
      // treating a bare-text-as-HTML body as malformed markup.
      text: body,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || 'Failed to send email.');
  }
  return { id: data?.id };
}
