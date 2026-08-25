import { describe, expect, it } from 'vitest';
import { classifyLeadByKeywords, escapeTelegramHtml, formatTelegramHtml, getAutomationActive, replyRuleTriggerMatches, splitReplyRuleTriggers, telegramReactionName } from '../../../api/telegram/webhook.js';

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
