import { generateOpenRouterText } from '../_openrouter.js';

const TELEGRAM_LIMIT = 3900;

const containsKhmer = (text) => /[\u1780-\u17FF]/.test(text || '');

const telegramApi = async (token, method, payload) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data?.description || `Telegram ${method} failed.`);
  }

  return data;
};

const chunkMessage = (text) => {
  const chunks = [];
  let remaining = String(text || '').trim();

  while (remaining.length > TELEGRAM_LIMIT) {
    const slice = remaining.slice(0, TELEGRAM_LIMIT);
    const breakAt = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('\n'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf('។'),
      slice.lastIndexOf(' '),
    );
    const cut = breakAt > 1000 ? breakAt + 1 : TELEGRAM_LIMIT;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

const welcomeMessage = (isKhmer) => isKhmer
  ? [
      'សួស្តី! ខ្ញុំជា Telegram chatbot របស់ aime.angkorgate។',
      'អ្នកអាចសួរខ្ញុំអំពី TikTok, Facebook, X, គំនិត content, caption, hashtag, video script, ឬយុទ្ធសាស្ត្រ marketing។',
      '',
      'ឧទាហរណ៍: បង្កើត content TikTok 10 គំនិត សម្រាប់ផលិតផល skincare។',
    ].join('\n')
  : [
      'Hello! I am the Telegram chatbot for aime.angkorgate.',
      'Ask me about TikTok, Facebook, X, content ideas, captions, hashtags, video scripts, or marketing strategy.',
      '',
      'Example: Create 10 TikTok content ideas for a skincare product.',
    ].join('\n');

const buildSystemPrompt = () => [
  'You are the Telegram chatbot for aime.angkorgate, an AI marketing assistant.',
  'Answer in the same language as the user. If the user writes Khmer, reply in clear natural Khmer. If the user writes English, reply in English.',
  'Help users with TikTok, Facebook, X, Telegram content ideas, viral hooks, captions, hashtags, video scripts, content calendars, account troubleshooting, and marketing strategy.',
  'When the user asks to create content, give practical ready-to-use output: ideas, hooks, caption, hashtags, and next action.',
  'Keep Telegram replies concise, friendly, and useful. Avoid long theory unless the user asks for details.',
  'Do not claim that you posted, scheduled, or changed settings unless the user explicitly asks and an integration confirms it.',
].join(' ');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not configured in Vercel.' });
  }

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'Invalid Telegram webhook secret.' });
  }

  const update = req.body || {};
  const message = update.message || update.edited_message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || message?.caption || '').trim();

  if (!chatId) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  if (!text) {
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: containsKhmer(message?.chat?.first_name)
        ? 'សូមផ្ញើសំណួរ ឬអត្ថបទដែលអ្នកចង់ឲ្យខ្ញុំជួយបង្កើត content។'
        : 'Please send a question or a content request for me to help with.',
    });
    return res.status(200).json({ ok: true });
  }

  const isKhmer = containsKhmer(text);
  if (/^\/(start|help)\b/i.test(text)) {
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: welcomeMessage(isKhmer),
      disable_web_page_preview: true,
    });
    return res.status(200).json({ ok: true });
  }

  try {
    await telegramApi(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    });

    const answer = await generateOpenRouterText({
      system: buildSystemPrompt(),
      prompt: text,
      model: process.env.OPEN_ROUTER_MODEL,
    });

    const reply = (answer || '').trim() || (isKhmer
      ? 'សូមទោស ខ្ញុំមិនអាចបង្កើតចម្លើយបានពេលនេះទេ។ សូមសាកល្បងម្ដងទៀត។'
      : 'Sorry, I could not generate a reply right now. Please try again.');

    for (const chunk of chunkMessage(reply)) {
      await telegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: false,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    const fallback = isKhmer
      ? `មានបញ្ហាពេលឆ្លើយតប: ${error?.message || 'Unknown error'}`
      : `There was a problem replying: ${error?.message || 'Unknown error'}`;

    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: fallback.slice(0, TELEGRAM_LIMIT),
    }).catch(() => {});

    return res.status(200).json({ ok: false, error: error?.message || 'Telegram chatbot failed.' });
  }
}
