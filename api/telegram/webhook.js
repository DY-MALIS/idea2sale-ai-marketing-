import { generateOpenRouterText } from '../_openrouter.js';
import { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const TELEGRAM_LIMIT = 3900;

const LEAD_TAGS = ['interested', 'price-question', 'support', 'general'];

const findMatchingReplyRule = async (db, text) => {
  const lowerText = text.toLowerCase();
  const snapshot = await db.collection('reply_rules').where('platform', '==', 'TELEGRAM').limit(200).get();
  for (const doc of snapshot.docs) {
    const trigger = String(doc.data()?.trigger || '').trim().toLowerCase();
    if (trigger && lowerText.includes(trigger)) {
      return doc.data()?.response || null;
    }
  }
  return null;
};

const logMessage = async (db, chatId, direction, text, source) => {
  try {
    await db.collection('telegram_messages').add({
      chatId: String(chatId),
      direction,
      text: String(text || '').slice(0, 2000),
      source,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('Telegram message log failed:', error?.message || error);
  }
};

const classifyLead = async (text) => {
  try {
    const result = await generateOpenRouterText({
      system: 'Classify the intent of this first message from a new contact. Respond with ONLY one lowercase word from this exact list: interested, price-question, support, general. No punctuation, no explanation.',
      prompt: text.slice(0, 500),
    });
    const tag = String(result || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
    return LEAD_TAGS.includes(tag) ? tag : 'general';
  } catch {
    return 'general';
  }
};

const upsertTelegramLead = async (db, message, text) => {
  const chat = message?.chat || {};
  const chatId = String(chat.id);
  const leadRef = db.collection('telegram_leads').doc(chatId);

  try {
    const existingSnap = await leadRef.get();
    const displayName = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Telegram user';

    if (!existingSnap.exists) {
      const tag = await classifyLead(text);
      await leadRef.set({
        chatId,
        username: chat.username || null,
        displayName,
        tag,
        messageCount: 1,
        lastMessage: text.slice(0, 500),
        lastMessageAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      await leadRef.update({
        displayName,
        username: chat.username || null,
        messageCount: FieldValue.increment(1),
        lastMessage: text.slice(0, 500),
        lastMessageAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('Telegram lead capture failed:', error?.message || error);
  }
};

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
  const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post;
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

  let db = null;
  try {
    db = initFirebaseAdmin();
  } catch (error) {
    console.error('Firebase Admin not configured for Telegram CRM/rules:', error?.message || error);
  }

  if (db) {
    await upsertTelegramLead(db, message, text);
    await logMessage(db, chatId, 'in', text, 'user');
  }

  const isKhmer = containsKhmer(text);
  if (/^\/(start|help)\b/i.test(text)) {
    const welcome = welcomeMessage(isKhmer);
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: welcome,
      disable_web_page_preview: true,
    });
    if (db) await logMessage(db, chatId, 'out', welcome, 'system');
    return res.status(200).json({ ok: true });
  }

  if (db) {
    const ruleResponse = await findMatchingReplyRule(db, text).catch(() => null);
    if (ruleResponse) {
      await telegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text: ruleResponse,
        disable_web_page_preview: false,
      });
      await logMessage(db, chatId, 'out', ruleResponse, 'rule');
      return res.status(200).json({ ok: true, matchedRule: true });
    }
  }

  try {
    await telegramApi(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    }).catch(() => {});

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

    if (db) await logMessage(db, chatId, 'out', reply, 'ai');

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
