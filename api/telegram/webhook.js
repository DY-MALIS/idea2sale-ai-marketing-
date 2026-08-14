import { generateOpenRouterText } from '../_openrouter.js';
import admin, { initFirebaseAdmin } from '../_firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logAudit } from '../_audit.js';

const TELEGRAM_LIMIT = 3900;

const LEAD_TAGS = ['interested', 'price-question', 'support', 'general'];

export const splitReplyRuleTriggers = (value) => String(value || '')
  .normalize('NFKC')
  .split(/[,;|\n\r،，]+/u)
  .map((trigger) => trigger
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
    .trim()
    .toLocaleLowerCase())
  .filter(Boolean);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const replyRuleTriggerMatches = (text, trigger) => {
  const normalizedText = String(text || '').normalize('NFKC').toLocaleLowerCase();
  const normalizedTrigger = String(trigger || '').normalize('NFKC').trim().toLocaleLowerCase();
  if (!normalizedText || !normalizedTrigger) return false;

  // Short Latin keywords such as "hi" must not match inside words such as "this".
  if (/^[a-z0-9]+$/u.test(normalizedTrigger) && normalizedTrigger.length <= 3) {
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedTrigger)}($|[^\\p{L}\\p{N}])`,
      'u',
    ).test(normalizedText);
  }

  return normalizedText.includes(normalizedTrigger);
};

const findMatchingReplyRule = async (db, text) => {
  const snapshot = await db.collection('reply_rules').where('platform', '==', 'TELEGRAM').limit(200).get();
  const matches = [];

  for (const doc of snapshot.docs) {
    const rule = doc.data() || {};
    const triggers = splitReplyRuleTriggers(rule.trigger);
    const matchingTrigger = triggers
      .filter((trigger) => replyRuleTriggerMatches(text, trigger))
      .sort((a, b) => b.length - a.length)[0];

    if (matchingTrigger && String(rule.response || '').trim()) {
      matches.push({
        response: String(rule.response).trim(),
        triggerLength: matchingTrigger.length,
        createdAt: rule.createdAt?.toMillis?.() || 0,
      });
    }
  }

  // Prefer the most specific keyword, then the newest rule when two rules overlap.
  matches.sort((a, b) => b.triggerLength - a.triggerLength || b.createdAt - a.createdAt);
  return matches[0]?.response || null;
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

const getBusinessName = async (db) => {
  try {
    const snapshot = await db.collection('business_profiles').orderBy('updatedAt', 'desc').limit(1).get();
    const name = String(snapshot.docs[0]?.data()?.businessName || '').trim();
    return name || null;
  } catch (error) {
    console.error('Business profile lookup failed:', error?.message || error);
    return null;
  }
};

const containsKhmer = (text) => /[\u1780-\u17FF]/.test(text || '');

// Backs the "ACTIVE/PAUSED" toggle in Automation.tsx (settings/automation doc).
// Defaults to active (true) if the doc is missing or unreadable, so a Firestore
// hiccup fails open to "keep replying" rather than silently going dark.
export const getAutomationActive = async (db) => {
  try {
    const snap = await db.collection('settings').doc('automation').get();
    return snap.exists ? snap.data()?.active !== false : true;
  } catch (error) {
    console.error('Automation-active lookup failed, defaulting to active:', error?.message || error);
    return true;
  }
};

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

const welcomeMessage = (isKhmer, businessName) => {
  const name = businessName || 'aime.angkorgate';
  return isKhmer
    ? [
        `សួស្តី! ខ្ញុំជា Telegram chatbot របស់ ${name}។`,
        'អ្នកអាចសួរខ្ញុំអំពី TikTok, Facebook, X, គំនិត content, caption, hashtag, video script, ឬយុទ្ធសាស្ត្រ marketing។',
        '',
        'ឧទាហរណ៍: បង្កើត content TikTok 10 គំនិត សម្រាប់ផលិតផល skincare។',
      ].join('\n')
    : [
        `Hello! I am the Telegram chatbot for ${name}.`,
        'Ask me about TikTok, Facebook, X, content ideas, captions, hashtags, video scripts, or marketing strategy.',
        '',
        'Example: Create 10 TikTok content ideas for a skincare product.',
      ].join('\n');
};

const buildSystemPrompt = (businessName) => [
  `You are the Telegram chatbot for ${businessName || 'aime.angkorgate'}, an AI marketing assistant.`,
  businessName
    ? `You represent ${businessName}. When a customer asks who you are or what business this is, answer with ${businessName}, and naturally note relevant details about them if it helps the conversation.`
    : '',
  'Answer in the same language as the user. If the user writes Khmer, reply in clear natural Khmer. If the user writes English, reply in English.',
  'Help users with TikTok, Facebook, X, Telegram content ideas, viral hooks, captions, hashtags, video scripts, content calendars, account troubleshooting, and marketing strategy.',
  'When the user asks to create content, give practical ready-to-use output: ideas, hooks, caption, hashtags, and next action.',
  'Keep Telegram replies concise, friendly, and useful. Avoid long theory unless the user asks for details.',
  'Do not claim that you posted, scheduled, or changed settings unless the user explicitly asks and an integration confirms it.',
].filter(Boolean).join(' ');

const sendManualReply = async (req, res) => {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not configured in Vercel.' });
  }

  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    return res.status(401).json({ error: 'Please sign in before replying.' });
  }

  const chatId = String(req.body?.chatId || '').trim();
  const text = String(req.body?.text || '').trim();
  if (!chatId || !text) {
    return res.status(400).json({ error: 'chatId and text are required.' });
  }

  let db;
  let decoded;
  try {
    db = initFirebaseAdmin();
    decoded = await admin.auth().verifyIdToken(idToken, true);
  } catch (error) {
    return res.status(401).json({ error: 'Sign-in verification failed.' });
  }

  try {
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: false,
    });
    await logMessage(db, chatId, 'out', text, 'system');
    await logAudit(db, { action: 'telegram_manual_reply', actorUid: decoded.uid, meta: { chatId } });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(502).json({ error: error?.message || 'Could not send this reply.' });
  }
};

const getBaseUrl = (req) => {
  const configured = (process.env.APP_URL || process.env.PUBLIC_APP_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (configured) return configured.startsWith('http') ? configured.replace(/\/$/, '') : `https://${configured.replace(/\/$/, '')}`;

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'aime.angkorgate.ai';
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  return `${protocol}://${host}`.replace(/\/$/, '');
};

const setWebhook = async (req, res) => {
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
    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
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
};

export default async function handler(req, res) {
  if (req.query?.action === 'set-webhook') {
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    return setWebhook(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.query?.action === 'reply') {
    return sendManualReply(req, res);
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

  // Channel posts include this app's own scheduled content arriving in the
  // channel (see api/telegram/run-scheduled.js / deliver.js) — auto-replying
  // to those created a self-reply loop where the bot "answered" its own
  // scheduled posts with a generic assistant greeting. Only direct
  // messages to the bot (private/group chat) should get a conversational
  // AI reply; channel posts are never a question that needs answering.
  if (update.channel_post || update.edited_channel_post) {
    return res.status(200).json({ ok: true, ignored: 'channel_post' });
  }

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

  const businessName = db ? await getBusinessName(db) : null;
  const isKhmer = containsKhmer(text);
  if (/^\/(start|help)\b/i.test(text)) {
    const welcome = welcomeMessage(isKhmer, businessName);
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: welcome,
      disable_web_page_preview: true,
    });
    if (db) await logMessage(db, chatId, 'out', welcome, 'system');
    return res.status(200).json({ ok: true });
  }

  // Lead capture/logging above always runs (that's CRM data collection, not
  // "automation"); only the rule-matched and AI-generated auto-replies below are
  // gated -- this is what Automation.tsx's ACTIVE/PAUSED toggle actually controls.
  const automationActive = db ? await getAutomationActive(db) : true;
  if (!automationActive) {
    return res.status(200).json({ ok: true, automationPaused: true });
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
      system: buildSystemPrompt(businessName),
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
