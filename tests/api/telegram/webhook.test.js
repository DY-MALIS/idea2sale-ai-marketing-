import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyLeadByKeywords,
  escapeTelegramHtml,
  findMatchingReplyRule,
  formatTelegramHtml,
  getAutomationActive,
  messageLeadContext,
  replyRuleTriggerMatches,
  resolveOwnerBotToken,
  splitReplyRuleTriggers,
  telegramReactionName,
} from '../../../api/telegram/webhook.js';

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('getAutomationActive', () => {
  const makeFakeDb = (data) => ({
    collection: () => ({
      doc: () => ({
        async get() {
          return { exists: data !== undefined, data: () => data };
        },
      }),
    }),
  });

  it('defaults to active when the settings doc does not exist', async () => {
    const db = makeFakeDb(undefined);
    expect(await getAutomationActive(db)).toBe(true);
  });

  it('is active when active is explicitly true', async () => {
    const db = makeFakeDb({ active: true });
    expect(await getAutomationActive(db)).toBe(true);
  });

  it('is paused only when active is explicitly false', async () => {
    const db = makeFakeDb({ active: false });
    expect(await getAutomationActive(db)).toBe(false);
  });

  it('fails open (active) if the lookup throws', async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          async get() {
            throw new Error('firestore down');
          },
        }),
      }),
    };
    expect(await getAutomationActive(db)).toBe(true);
  });

  it('reads a per-owner doc (automation_{ownerId}) instead of the shared one when an ownerId is passed', async () => {
    const seenDocIds = [];
    const db = {
      collection: () => ({
        doc: (id) => {
          seenDocIds.push(id);
          return { async get() { return { exists: true, data: () => ({ active: false }) }; } };
        },
      }),
    };
    expect(await getAutomationActive(db, 'owner-1')).toBe(false);
    expect(seenDocIds).toEqual(['automation_owner-1']);
  });
});

// A per-user bot's incoming chat.id is the same real Telegram account ID
// regardless of which bot the customer is messaging -- messageLeadContext
// must disambiguate by owner or two different businesses' bots talking to the
// same customer would collide on one shared telegram_leads/telegram_messages
// document. The shared bot (no ownerId) must keep its original, unprefixed ID
// scheme so existing leads keep resolving to the same document.
describe('messageLeadContext', () => {
  const privateMessage = { chat: { id: 555, type: 'private' }, from: { id: 555, first_name: 'Dara' } };

  it('leaves the shared bot (no ownerId) with unprefixed IDs, unchanged from before this feature', () => {
    const context = messageLeadContext(privateMessage, null);
    expect(context.conversationId).toBe('555');
    expect(context.replyChatId).toBe('555');
  });

  it('prefixes the conversationId with the ownerId for a per-user bot', () => {
    const context = messageLeadContext(privateMessage, 'owner-a');
    expect(context.conversationId).toBe('owner-a_555');
    // The real chat id used to actually send the reply must stay the raw
    // Telegram id -- Telegram has no idea about our ownerId prefix.
    expect(context.replyChatId).toBe('555');
  });

  it('gives two different owners distinct conversationIds for the same real customer', () => {
    const a = messageLeadContext(privateMessage, 'owner-a');
    const b = messageLeadContext(privateMessage, 'owner-b');
    expect(a.conversationId).not.toBe(b.conversationId);
  });
});

describe('resolveOwnerBotToken', () => {
  it('returns the shared token when no ownerId is given', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    expect(await resolveOwnerBotToken(null, null)).toBe('shared-token');
  });

  it("returns the owner's own token when their profile has one", async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    const db = { collection: () => ({ doc: () => ({ async get() { return { data: () => ({ telegramBotToken: 'own-token' }) }; } }) }) };
    expect(await resolveOwnerBotToken(db, 'owner-1')).toBe('own-token');
  });

  it('falls back to the shared token if the owner has no token saved', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    const db = { collection: () => ({ doc: () => ({ async get() { return { data: () => ({}) }; } }) }) };
    expect(await resolveOwnerBotToken(db, 'owner-1')).toBe('shared-token');
  });

  it('falls back to the shared token if the profile lookup throws', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'shared-token';
    const db = { collection: () => ({ doc: () => ({ async get() { throw new Error('offline'); } }) }) };
    expect(await resolveOwnerBotToken(db, 'owner-1')).toBe('shared-token');
  });
});

describe('findMatchingReplyRule', () => {
  // A minimal chainable query stub: each .where() narrows the in-memory rule
  // list by an exact-match field/value, mirroring how the real Firestore
  // query in findMatchingReplyRule chains .where('platform', ...) and,
  // only when an ownerId is given, a second .where('userId', ...).
  const fakeRulesDb = (rules) => {
    const makeQuery = (filtered) => ({
      where: (field, _op, value) => makeQuery(filtered.filter((r) => r[field] === value)),
      limit: () => ({ async get() { return { docs: filtered.map((data) => ({ data: () => data })) } } }),
    });
    return { collection: () => makeQuery(rules) };
  };

  it('matches any rule for the shared bot (no ownerId), same as before this feature', async () => {
    const db = fakeRulesDb([{ platform: 'TELEGRAM', trigger: 'price', response: 'It is $10', userId: 'someone-else' }]);
    expect(await findMatchingReplyRule(db, 'what is the price?', null)).toBe('It is $10');
  });

  it("only matches the bot owner's own rules when an ownerId is given", async () => {
    const db = fakeRulesDb([
      { platform: 'TELEGRAM', trigger: 'price', response: 'Owner A price', userId: 'owner-a' },
      { platform: 'TELEGRAM', trigger: 'price', response: 'Owner B price', userId: 'owner-b' },
    ]);
    expect(await findMatchingReplyRule(db, 'price please', 'owner-a')).toBe('Owner A price');
  });
});

describe('splitReplyRuleTriggers / replyRuleTriggerMatches (sanity)', () => {
  it('splits comma/pipe/newline separated triggers', () => {
    expect(splitReplyRuleTriggers('hi, price | delivery\nrefund')).toEqual([
      'hi', 'price', 'delivery', 'refund',
    ]);
  });

  it('matches short Latin triggers only on word boundaries', () => {
    expect(replyRuleTriggerMatches('hi there', 'hi')).toBe(true);
    expect(replyRuleTriggerMatches('this is a test', 'hi')).toBe(false);
  });
});

// Regression coverage for the Telegram Markdown-to-HTML formatting fixed in
// this session -- Telegram never renders raw Markdown, so every one of these
// constructs used to show up as literal broken symbols (**, *, [text](url),
// "- item") in chat replies before this conversion existed.
describe('escapeTelegramHtml', () => {
  it('escapes &, <, > so a stray one never breaks parse_mode=HTML', () => {
    expect(escapeTelegramHtml('AT&T <script> a>b')).toBe('AT&amp;T &lt;script&gt; a&gt;b');
  });
});

describe('formatTelegramHtml', () => {
  it('converts bold, italic, inline code, and headings', () => {
    expect(formatTelegramHtml('## Hook\n**bold** and *italic* and `code`'))
      .toBe('<b>Hook</b>\n<b>bold</b> and <i>italic</i> and <code>code</code>');
  });

  it('converts markdown links', () => {
    expect(formatTelegramHtml('See [our site](https://example.com) now'))
      .toBe('See <a href="https://example.com">our site</a> now');
  });

  it('converts list markers to bullets without touching numbered lists', () => {
    expect(formatTelegramHtml('- one\n- two\n1. three')).toBe('• one\n• two\n1. three');
  });

  it('does not misread a spaced multiplication sign as italic emphasis', () => {
    expect(formatTelegramHtml('Price: $5 * 2 = $10')).toBe('Price: $5 * 2 = $10');
  });
});

describe('telegramReactionName', () => {
  it('normalizes standard, custom, and paid Telegram reactions', () => {
    expect(telegramReactionName({ type: 'emoji', emoji: '👍' })).toBe('👍');
    expect(telegramReactionName({ type: 'custom_emoji', custom_emoji_id: '123' })).toBe('custom:123');
    expect(telegramReactionName({ type: 'paid' })).toBe('paid');
  });
});

describe('classifyLeadByKeywords', () => {
  it('classifies Khmer and English content creation requests as interested', () => {
    expect(classifyLeadByKeywords('ខ្ញុំចង់ឲ្យអ្នកបង្កើត content ដែលទាក់ទាញខ្លាំង')).toBe('interested');
    expect(classifyLeadByKeywords('I want you to create content for my business')).toBe('interested');
  });

  it('keeps price questions and technical support separate', () => {
    expect(classifyLeadByKeywords('ធ្វើ content តម្លៃប៉ុន្មាន?')).toBe('price-question');
    expect(classifyLeadByKeywords('កម្មវិធីមានបញ្ហា ប្រើមិនបាន')).toBe('support');
  });

  it('leaves greetings for the AI/general fallback', () => {
    expect(classifyLeadByKeywords('សួស្តី')).toBeNull();
  });
});
