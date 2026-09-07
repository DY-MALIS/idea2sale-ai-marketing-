import { generateOpenRouterText, redactSecrets } from '../_openrouter.js';
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

// A per-user bot (see resolveBotContext) only matches that user's own rules --
// reply_rules already carries userId for edit-ownership, but matching used to
// ignore it and apply every rule to every bot. The shared bot (ownerId null)
// keeps its original app-wide behavior unchanged, matching any rule.
export const findMatchingReplyRule = async (db, text, ownerId) => {
  const base = db.collection('reply_rules').where('platform', '==', 'TELEGRAM');
  const snapshot = await (ownerId ? base.where('userId', '==', ownerId) : base).limit(200).get();
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

const logMessage = async (db, chatId, direction, text, source, ownerId) => {
  try {
    await db.collection('telegram_messages').add({
      chatId: String(chatId),
      ownerId: ownerId || null,
      direction,
      text: String(text || '').slice(0, 2000),
      source,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error('Telegram message log failed:', error?.message || error);
  }
};

export const telegramReactionName = (reaction) => {
  if (reaction?.type === 'emoji') return String(reaction.emoji || 'reaction');
  if (reaction?.type === 'custom_emoji') return `custom:${reaction.custom_emoji_id || 'reaction'}`;
  if (reaction?.type === 'paid') return 'paid';
  return 'reaction';
};

// A real Telegram user's chat.id in a private chat is their own numeric
// Telegram account ID, which is the same regardless of which bot they're
// messaging -- so the same customer messaging two different owners' bots
// would collide on the same conversationId without this prefix. The shared
// bot (ownerId null) keeps its original unprefixed IDs so existing
// telegram_leads/telegram_messages docs keep resolving to the same lead.
export const messageLeadContext = (message, ownerId) => {
  const chat = message?.chat || {};
  const actor = message?.from || chat;
  const isGroupComment = chat.type === 'group' || chat.type === 'supergroup';
  const actorId = String(actor.id ?? chat.id ?? 'unknown');
  const replyChatId = String(chat.id ?? actor.id ?? '');
  const rawConversationId = isGroupComment ? `${replyChatId}:${actorId}` : replyChatId;
  return {
    actor,
    actorId,
    conversationId: ownerId ? `${ownerId}_${rawConversationId}` : rawConversationId,
    replyChatId,
    replyToMessageId: isGroupComment ? message?.message_id || null : null,
    source: isGroupComment ? 'channel-comment' : 'user',
    canReply: Boolean(replyChatId),
  };
};

const includesAny = (text, phrases) => phrases.some((phrase) => text.includes(phrase));

export const classifyLeadByKeywords = (value) => {
  const text = String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
  if (!text) return null;

  // A price question is the most specific commercial intent.
  if (includesAny(text, [
    'តម្លៃ', 'ថ្លៃប៉ុន្មាន', 'ប៉ុន្មានដុល្លារ', 'អស់ប៉ុន្មាន',
    'price', 'pricing', 'how much', 'cost', 'quotation', 'quote',
  ])) return 'price-question';

  // Reserve support for an actual problem; a request to create content is a sales lead.
  if (includesAny(text, [
    'មិនដំណើរការ', 'ប្រើមិនបាន', 'មានបញ្ហា', 'ខូច', 'កំហុស',
    'not working', 'does not work', "doesn't work", 'error', 'broken',
    'technical support', 'bug', 'fix this',
  ])) return 'support';

  if (includesAny(text, [
    'ចង់', 'ចាប់អារម្មណ៍', 'បង្កើត', 'កម្ម៉ង់', 'កុម្ម៉ង់', 'ទិញ',
    'ជួល', 'ប្រើសេវា', 'សុំធ្វើ', 'ធ្វើឲ្យ', 'ធ្វើអោយ',
    'interested', 'i want', "i'd like", 'would like', 'need you to',
    'create content', 'make content', 'order', 'buy', 'hire', 'use your service',
  ])) return 'interested';

  return null;
};

const ensureStoredLeadIntentTags = async (db) => {
  const snapshot = await db.collection('telegram_leads').get();
  const updates = snapshot.docs.filter((leadDoc) => {
    if (leadDoc.id.startsWith('_')) return false;
    const lead = leadDoc.data() || {};
    if (lead.source === 'channel-comment') return false;
    const detectedTag = classifyLeadByKeywords(lead.lastMessage);
    return detectedTag && detectedTag !== lead.tag;
  }).map((leadDoc) => ({
    ref: leadDoc.ref,
    tag: classifyLeadByKeywords(leadDoc.data()?.lastMessage),
  }));

  for (let index = 0; index < updates.length; index += 400) {
    const batch = db.batch();
    updates.slice(index, index + 400).forEach(({ ref, tag }) => {
      batch.update(ref, { tag });
    });
    await batch.commit();
  }

  return updates.length;
};

const classifyLead = async (text) => {
  const keywordTag = classifyLeadByKeywords(text);
  if (keywordTag) return keywordTag;

  try {
    const result = await generateOpenRouterText({
      system: `Classify this Telegram contact message. Understand both Khmer and English.
Return ONLY one exact lowercase tag: interested, price-question, support, general.
- interested: wants, requests, orders, hires, buys, or asks us to create content or provide a service.
- price-question: asks about price, cost, quotation, package, or payment.
- support: reports a technical problem, error, broken feature, or asks to fix an existing problem.
- general: greeting, thanks, casual conversation, or information with no buying/service intent.
A request such as "I want you to create attractive content" is interested, not general or support.`,
      prompt: text.slice(0, 500),
    });
    const tag = String(result || '').trim().toLowerCase().replace(/[^a-z-]/g, '');
    return LEAD_TAGS.includes(tag) ? tag : 'general';
  } catch {
    return 'general';
  }
};

const upsertTelegramLead = async (db, message, text, forcedTag, ownerId) => {
  const context = messageLeadContext(message, ownerId);
  const leadRef = db.collection('telegram_leads').doc(context.conversationId);

  try {
    const existingSnap = await leadRef.get();
    const displayName = [context.actor.first_name, context.actor.last_name].filter(Boolean).join(' ') || context.actor.username || 'Telegram user';

    if (!existingSnap.exists) {
      const tag = forcedTag || await classifyLead(text);
      await leadRef.set({
        chatId: context.conversationId,
        ownerId: ownerId || null,
        replyChatId: context.replyChatId,
        replyToMessageId: context.replyToMessageId,
        telegramUserId: context.actorId,
        username: context.actor.username || null,
        displayName,
        tag,
        source: context.source,
        canReply: context.canReply,
        messageCount: 1,
        lastMessage: text.slice(0, 500),
        lastMessageAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      const currentTag = existingSnap.data()?.tag;
      const detectedTag = forcedTag || await classifyLead(text);
      const nextTag = detectedTag !== 'general' || !currentTag ? detectedTag : currentTag;
      await leadRef.update({
        displayName,
        username: context.actor.username || null,
        replyChatId: context.replyChatId,
        replyToMessageId: context.replyToMessageId,
        source: context.source,
        tag: nextTag,
        messageCount: FieldValue.increment(1),
        lastMessage: text.slice(0, 500),
        lastMessageAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('Telegram lead capture failed:', error?.message || error);
  }

  return context;
};

const recordReactionUpdate = async (db, update) => {
  const detailed = update?.message_reaction;
  const aggregate = update?.message_reaction_count;
  const reactionUpdate = detailed || aggregate;
  const chatId = String(reactionUpdate?.chat?.id || '');
  const messageId = Number(reactionUpdate?.message_id);
  if (!chatId || !Number.isFinite(messageId)) return;

  if (aggregate) {
    const reactions = Array.isArray(aggregate.reactions)
      ? aggregate.reactions.map((item) => ({
          reaction: telegramReactionName(item?.type),
          count: Number(item?.total_count) || 0,
        }))
      : [];
    const totalCount = reactions.reduce((sum, item) => sum + item.count, 0);
    const engagementRef = db.collection('telegram_channel_engagement').doc(`${chatId}_${messageId}`);
    const summaryRef = db.collection('telegram_leads').doc('_channel_reactions');
    await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(engagementRef);
      const previousCount = Number(previous.data()?.totalCount) || 0;
      transaction.set(engagementRef, {
        kind: 'aggregate',
        chatId,
        messageId,
        reactions,
        totalCount,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(summaryRef, {
        kind: 'engagement-summary',
        totalCount: FieldValue.increment(totalCount - previousCount),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    return;
  }

  const actor = detailed.user || detailed.actor_chat;
  if (!actor?.id) return;
  const reactionNames = Array.isArray(detailed.new_reaction)
    ? detailed.new_reaction.map(telegramReactionName)
    : [];
  const actorRef = db.collection('telegram_channel_engagement').doc(`${chatId}_${messageId}_${actor.id}`);
  const aggregateRef = db.collection('telegram_channel_engagement').doc(`${chatId}_${messageId}`);
  const summaryRef = db.collection('telegram_leads').doc('_channel_reactions');
  await db.runTransaction(async (transaction) => {
    // Derive the delta from our last stored state, not Telegram's old_reaction
    // field. Telegram can retry the same webhook update; using stored state
    // makes retries idempotent instead of incrementing/decrementing twice.
    const actorSnapshot = await transaction.get(actorRef);
    const aggregateSnapshot = await transaction.get(aggregateRef);
    const previousActorTotal = Number(actorSnapshot.data()?.totalCount) || 0;
    const reactionDelta = reactionNames.length - previousActorTotal;
    const currentTotal = Number(aggregateSnapshot.data()?.totalCount) || 0;
    const nextTotal = Math.max(0, currentTotal + reactionDelta);
    const appliedDelta = nextTotal - currentTotal;

    transaction.set(actorRef, {
      kind: 'actor',
      chatId,
      messageId,
      actorId: String(actor.id),
      username: actor.username || null,
      displayName: [actor.first_name, actor.last_name].filter(Boolean).join(' ') || actor.username || 'Telegram user',
      reactions: reactionNames,
      totalCount: reactionNames.length,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(aggregateRef, {
      kind: 'aggregate',
      chatId,
      messageId,
      totalCount: nextTotal,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (appliedDelta) {
      transaction.set(summaryRef, {
        kind: 'engagement-summary',
        totalCount: FieldValue.increment(appliedDelta),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  if (reactionNames.length) {
    await upsertTelegramLead(db, {
      chat: { id: actor.id, type: 'private' },
      from: actor,
    }, `Reacted ${reactionNames.join(' ')}`, 'interested');
  }
};

const recordChannelComment = async (db, message, text) => {
  const chatId = String(message?.chat?.id || '');
  const messageId = Number(message?.message_id);
  if (!chatId || !Number.isFinite(messageId)) return;

  const eventRef = db.collection('telegram_channel_engagement').doc(`${chatId}_comment_${messageId}`);
  const summaryRef = db.collection('telegram_leads').doc('_channel_comments');
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(eventRef);
    transaction.set(eventRef, {
      kind: 'comment',
      chatId,
      messageId,
      actorId: String(message?.from?.id || message?.sender_chat?.id || ''),
      text: text.slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    if (!existing.exists) {
      transaction.set(summaryRef, {
        kind: 'comment-summary',
        totalCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
};

const ensureChannelCommentSummary = async (db) => {
  const summaryRef = db.collection('telegram_leads').doc('_channel_comments');
  const [legacyComments, commentLeads] = await Promise.all([
    db.collection('telegram_messages').where('source', '==', 'channel-comment').get(),
    db.collection('telegram_leads').where('source', '==', 'channel-comment').get(),
  ]);
  const leadMessageCount = commentLeads.docs.reduce(
    (total, lead) => total + Math.max(1, Number(lead.data()?.messageCount) || 0),
    0,
  );
  const recoveredTotal = Math.max(legacyComments.size, leadMessageCount);
  await db.runTransaction(async (transaction) => {
    const summary = await transaction.get(summaryRef);
    const currentTotal = Number(summary.data()?.totalCount) || 0;
    if (!summary.exists || recoveredTotal > currentTotal) {
      transaction.set(summaryRef, {
        kind: 'comment-summary',
        totalCount: recoveredTotal,
        updatedAt: FieldValue.serverTimestamp(),
        lastMessageAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });
};

// For a per-user bot, the owner's own profile is the only correct answer.
// The shared bot has no single owner, so it keeps its original heuristic
// (whichever profile was touched most recently) unchanged.
const getBusinessName = async (db, ownerId) => {
  try {
    if (ownerId) {
      const snap = await db.collection('business_profiles').doc(ownerId).get();
      return String(snap.data()?.businessName || '').trim() || null;
    }
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
export const getAutomationActive = async (db, ownerId) => {
  try {
    const docId = ownerId ? `automation_${ownerId}` : 'automation';
    const snap = await db.collection('settings').doc(docId).get();
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

export const escapeTelegramHtml = (value = '') => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

export const formatTelegramHtml = (value = '') => escapeTelegramHtml(value)
  .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
  .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  // Single-marker italic, run after ** is already consumed above -- requires a
  // non-space character on both sides of the marker so things like "5 * 2" or a
  // lone bullet dash never get misread as the start of emphasis.
  .replace(/(?<![*\w])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?!\*)/g, '<i>$1</i>')
  .replace(/(?<![_\w])_([^\s_][^_\n]*?[^\s_]|[^\s_])_(?!_)/g, '<i>$1</i>')
  // Telegram has no <ul>/<li> -- the closest visual equivalent is a plain bullet.
  .replace(/^\s*[-*]\s+/gm, '• ');

const sendTelegramHtmlMessage = (token, chatId, text, options = {}) => telegramApi(token, 'sendMessage', {
  chat_id: chatId,
  text: formatTelegramHtml(text),
  parse_mode: 'HTML',
  disable_web_page_preview: Boolean(options.disableWebPagePreview),
  ...(options.replyToMessageId ? {
    reply_parameters: { message_id: Number(options.replyToMessageId), allow_sending_without_reply: true },
  } : {}),
});

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

const buildSystemPrompt = (businessName, isKhmer) => [
  `You are the Telegram chatbot for ${businessName || 'aime.angkorgate'}, an AI marketing assistant.`,
  isKhmer
    ? 'LANGUAGE REQUIREMENT FOR THIS MESSAGE: Reply in natural Khmer. Do not answer in English except for necessary brand names or technical terms.'
    : 'LANGUAGE REQUIREMENT FOR THIS MESSAGE: Reply in English. Do not answer in Khmer.',
  businessName
    ? `You represent ${businessName}. When a customer asks who you are or what business this is, answer with ${businessName}, and naturally note relevant details about them if it helps the conversation.`
    : '',
  'Answer in the same language as the user. If the user writes Khmer, reply in clear natural Khmer. If the user writes English, reply in English.',
  'Help users with TikTok, Facebook, X, Telegram content ideas, viral hooks, captions, hashtags, video scripts, content calendars, account troubleshooting, and marketing strategy.',
  'When the user asks to create content, give practical ready-to-use output: ideas, hooks, caption, hashtags, and next action.',
  'Keep Telegram replies concise, friendly, and useful. Avoid long theory unless the user asks for details.',
  'Do not claim that you posted, scheduled, or changed settings unless the user explicitly asks and an integration confirms it.',
].filter(Boolean).join(' ');

// Resolves which bot token owns a given business (used both for a per-user
// bot's incoming webhook and for replying to one of its captured leads).
export const resolveOwnerBotToken = async (db, ownerId) => {
  const sharedToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (db && ownerId) {
    try {
      const snap = await db.collection('business_profiles').doc(ownerId).get();
      const ownToken = (snap.data()?.telegramBotToken || '').trim();
      if (ownToken) return ownToken;
    } catch (error) {
      console.error("Could not load the bot owner's Telegram profile, using the shared bot:", error?.message);
    }
  }
  return sharedToken;
};

const sendManualReply = async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    return res.status(401).json({ error: 'Please sign in before replying.' });
  }

  const chatId = String(req.body?.chatId || '').trim();
  const conversationId = String(req.body?.conversationId || chatId).trim();
  const replyToMessageId = Number(req.body?.replyToMessageId) || null;
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

  // The lead itself records which bot captured it (ownerId, absent for the
  // legacy shared bot) -- that, not anything the client claims, decides which
  // bot token replies and who is allowed to send this reply at all.
  let ownerId = null;
  try {
    const leadSnap = await db.collection('telegram_leads').doc(conversationId).get();
    ownerId = leadSnap.data()?.ownerId || null;
  } catch (error) {
    console.error('Could not load lead for reply ownership check:', error?.message);
  }

  const isCallerAdmin = await db.collection('admins').doc(decoded.uid).get().then((snap) => snap.exists).catch(() => false);
  if (ownerId ? (decoded.uid !== ownerId && !isCallerAdmin) : !isCallerAdmin) {
    return res.status(403).json({ error: 'You do not have permission to reply to this conversation.' });
  }

  const token = await resolveOwnerBotToken(db, ownerId);
  if (!token) {
    return res.status(503).json({ error: 'Telegram bot is not configured.' });
  }

  try {
    await sendTelegramHtmlMessage(token, chatId, text, { replyToMessageId });
    await logMessage(db, conversationId, 'out', text, 'system', ownerId);
    await logAudit(db, { action: 'telegram_manual_reply', actorUid: decoded.uid, meta: { chatId, conversationId, replyToMessageId } });
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
    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'message_reaction', 'message_reaction_count'],
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

    const webhookInfoResponse = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const webhookInfoData = await webhookInfoResponse.json().catch(() => ({}));
    const allowedUpdates = webhookInfoData?.result?.allowed_updates || [];
    let botIsChannelAdmin = false;
    let discussionGroupLinked = false;
    let botIsDiscussionAdmin = false;
    const configuredChatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
    if (configuredChatId) {
      const botData = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((result) => result.json()).catch(() => ({}));
      const botId = botData?.result?.id;
      if (botId) {
        const memberData = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(configuredChatId)}&user_id=${botId}`)
          .then((result) => result.json()).catch(() => ({}));
        botIsChannelAdmin = ['administrator', 'creator'].includes(memberData?.result?.status);
        const channelData = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(configuredChatId)}`)
          .then((result) => result.json()).catch(() => ({}));
        const linkedChatId = channelData?.result?.linked_chat_id;
        discussionGroupLinked = Boolean(linkedChatId);
        if (linkedChatId) {
          const discussionMemberData = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${linkedChatId}&user_id=${botId}`)
            .then((result) => result.json()).catch(() => ({}));
          botIsDiscussionAdmin = ['administrator', 'creator'].includes(discussionMemberData?.result?.status);
        }
      }
    }
    let reclassifiedLeads = 0;
    try {
      const db = initFirebaseAdmin();
      await ensureChannelCommentSummary(db);
      reclassifiedLeads = await ensureStoredLeadIntentTags(db);
    } catch (error) {
      console.error('Telegram CRM backfill failed:', error?.message || error);
    }

    return res.status(200).json({
      ok: true,
      webhookUrl,
      message: 'Telegram chatbot webhook is active. Send /start to your bot in Telegram.',
      telegram: data,
      diagnostics: {
        reactionUpdatesEnabled: allowedUpdates.includes('message_reaction') && allowedUpdates.includes('message_reaction_count'),
        botIsChannelAdmin,
        discussionGroupLinked,
        botIsDiscussionAdmin,
        reclassifiedLeads,
      },
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      webhookUrl,
      error: error?.message || 'Telegram webhook setup failed.',
    });
  }
};

// Lets a signed-in user point their own bot (saved in Business Profile) at
// this app, so their incoming messages get CRM capture + AI auto-reply using
// their own bot/data instead of the app's single shared bot. Distinct from
// setWebhook above (which registers the shared bot via an admin setup key,
// not a user's own idToken) -- kept separate rather than merged since the two
// have unrelated auth models and target different bots.
const activateOwnBot = async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) {
    return res.status(401).json({ error: 'Please sign in before activating your bot.' });
  }

  let db;
  let decoded;
  try {
    db = initFirebaseAdmin();
    decoded = await admin.auth().verifyIdToken(idToken, true);
  } catch (error) {
    return res.status(401).json({ error: 'Sign-in verification failed.' });
  }

  const deactivate = req.body?.deactivate === true;
  const profileSnap = await db.collection('business_profiles').doc(decoded.uid).get();
  const ownToken = (profileSnap.data()?.telegramBotToken || '').trim();
  if (!ownToken) {
    return res.status(400).json({ error: 'Save your own Telegram Bot Token in Business Profile first.' });
  }

  const baseUrl = getBaseUrl(req);
  const webhookUrl = `${baseUrl}/api/telegram/webhook?uid=${encodeURIComponent(decoded.uid)}`;
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();

  try {
    const response = await fetch(`https://api.telegram.org/bot${ownToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deactivate
        ? { url: '' }
        : {
            url: webhookUrl,
            allowed_updates: ['message', 'edited_message'],
            drop_pending_updates: false,
            ...(secret ? { secret_token: secret } : {}),
          }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return res.status(502).json({ ok: false, error: data?.description || 'Telegram setWebhook failed.' });
    }

    // Business Profile's own doc, not a separate collection, so the UI can
    // reflect activation state with the same onSnapshot listener it already
    // uses to load the saved bot token/chat ID.
    await db.collection('business_profiles').doc(decoded.uid).set({ telegramBotActive: !deactivate }, { merge: true });
    await logAudit(db, { action: deactivate ? 'telegram_own_bot_deactivated' : 'telegram_own_bot_activated', actorUid: decoded.uid });
    return res.status(200).json({
      ok: true,
      active: !deactivate,
      message: deactivate
        ? 'Your bot has been disconnected.'
        : 'Your bot is now active. Send /start to it on Telegram to test it.',
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error?.message || 'Could not update your bot webhook.' });
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

  if (req.query?.action === 'activate-bot') {
    return activateOwnBot(req, res);
  }

  // Present only for a per-user bot's own webhook URL (see activateOwnBot) --
  // the shared bot's webhook URL carries none, so ownerId stays null and every
  // function below falls back to its original single-tenant behavior exactly
  // as before this feature existed.
  const ownerId = String(req.query?.uid || '').trim() || null;

  let db = null;
  try {
    db = initFirebaseAdmin();
  } catch (error) {
    console.error('Firebase Admin not configured for Telegram CRM/rules:', error?.message || error);
  }

  const token = ownerId ? await resolveOwnerBotToken(db, ownerId) : (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not configured in Vercel.' });
  }

  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ error: 'Invalid Telegram webhook secret.' });
  }

  const update = req.body || {};

  if (update.message_reaction || update.message_reaction_count) {
    try {
      await recordReactionUpdate(db, update);
      return res.status(200).json({ ok: true, recorded: 'reaction' });
    } catch (error) {
      console.error('Telegram reaction capture failed:', error?.message || error);
      return res.status(200).json({ ok: false, ignored: 'reaction-storage-unavailable' });
    }
  }

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

  if (message?.from?.is_bot) {
    return res.status(200).json({ ok: true, ignored: 'bot-message' });
  }

  // Telegram automatically mirrors every new channel post into its linked
  // discussion group. That mirrored photo/video is the comment thread root,
  // not a customer message, so replying to it creates an unwanted generic bot
  // message above the first real comment. Real comments do not carry this flag.
  if (message?.is_automatic_forward) {
    return res.status(200).json({ ok: true, ignored: 'automatic-channel-forward' });
  }

  if (!text) {
    await sendTelegramHtmlMessage(
      token,
      chatId,
      containsKhmer(message?.chat?.first_name)
        ? 'សូមផ្ញើសំណួរ ឬអត្ថបទដែលអ្នកចង់ឲ្យខ្ញុំជួយបង្កើត content។'
        : 'Please send a question or a content request for me to help with.',
    );
    return res.status(200).json({ ok: true });
  }

  const leadContext = db
    ? await upsertTelegramLead(db, message, text, undefined, ownerId)
    : messageLeadContext(message, ownerId);
  if (db && ['group', 'supergroup'].includes(message?.chat?.type)) {
    await recordChannelComment(db, message, text).catch((error) => {
      console.error('Telegram comment count failed:', error?.message || error);
    });
  }
  if (db) await logMessage(db, leadContext.conversationId, 'in', text, leadContext.source, ownerId);

  const businessName = db ? await getBusinessName(db, ownerId) : null;
  const isKhmer = containsKhmer(text);
  if (/^\/(start|help)\b/i.test(text)) {
    const welcome = welcomeMessage(isKhmer, businessName);
    await sendTelegramHtmlMessage(token, chatId, welcome, { disableWebPagePreview: true, replyToMessageId: leadContext.replyToMessageId });
    if (db) await logMessage(db, leadContext.conversationId, 'out', welcome, 'system', ownerId);
    return res.status(200).json({ ok: true });
  }

  // Lead capture/logging above always runs (that's CRM data collection, not
  // "automation"); only the rule-matched and AI-generated auto-replies below are
  // gated -- this is what Automation.tsx's ACTIVE/PAUSED toggle actually controls.
  const automationActive = db ? await getAutomationActive(db, ownerId) : true;
  if (!automationActive) {
    return res.status(200).json({ ok: true, automationPaused: true });
  }

  if (db) {
    const ruleResponse = await findMatchingReplyRule(db, text, ownerId).catch(() => null);
    // Never send a saved English rule to a Khmer question (or vice versa).
    // A mismatched rule falls through to the language-locked AI response below.
    if (ruleResponse && containsKhmer(ruleResponse) === isKhmer) {
      await sendTelegramHtmlMessage(token, chatId, ruleResponse, { replyToMessageId: leadContext.replyToMessageId });
      await logMessage(db, leadContext.conversationId, 'out', ruleResponse, 'rule', ownerId);
      return res.status(200).json({ ok: true, matchedRule: true });
    }
  }

  try {
    await telegramApi(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    }).catch(() => {});

    const answer = await generateOpenRouterText({
      system: buildSystemPrompt(businessName, isKhmer),
      prompt: text,
      model: process.env.OPEN_ROUTER_MODEL,
    });

    const reply = (answer || '').trim() || (isKhmer
      ? 'សូមទោស ខ្ញុំមិនអាចបង្កើតចម្លើយបានពេលនេះទេ។ សូមសាកល្បងម្ដងទៀត។'
      : 'Sorry, I could not generate a reply right now. Please try again.');

    for (const chunk of chunkMessage(reply)) {
      await sendTelegramHtmlMessage(token, chatId, chunk, { replyToMessageId: leadContext.replyToMessageId });
    }

    if (db) await logMessage(db, leadContext.conversationId, 'out', reply, 'ai', ownerId);

    return res.status(200).json({ ok: true });
  } catch (error) {
    // redactSecrets guards against the same class of incident described in
    // _openrouter.js: a misconfigured env var (e.g. a secret pasted into a
    // model-name field) can make a provider echo that value back in its error
    // message -- this specific path sends the message straight to an actual
    // Telegram customer, so it's the most exposed of every place this app
    // surfaces a raw error message.
    const safeMessage = redactSecrets(error?.message) || 'Unknown error';
    const fallback = isKhmer
      ? `មានបញ្ហាពេលឆ្លើយតប: ${safeMessage}`
      : `There was a problem replying: ${safeMessage}`;

    await sendTelegramHtmlMessage(token, chatId, fallback.slice(0, TELEGRAM_LIMIT)).catch(() => {});

    return res.status(200).json({ ok: false, error: safeMessage });
  }
}
