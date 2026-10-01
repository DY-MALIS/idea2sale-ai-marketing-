import { describe, expect, it } from 'vitest';
import {
  classifyScanMode,
  DEFAULT_SCAN_ENTITY_CAP,
  DEFAULT_COMPETITOR_ENTITY_CAP,
  ensureBusinessInInboxMessage,
  extractRequestedLeadCount,
  findExactBusiness,
  FACEBOOK_SCAN_MODES,
  getFacebookCompetitorActivityWindow,
  getAiRateLimitPolicy,
  getVideoCaptionSpec,
  googleSheetsUrlToCsvExportUrl,
  resolveCreativeImageMode,
  resolveAgentReplyLanguage,
  isOwnBusinessNamedTarget,
  resolveAudienceResearchTarget,
  resolveProductAudienceTarget,
  resolveCompetitorResearchTarget,
  resolveFacebookScanMode,
  resolveVideoAspectRatio,
  shouldReuseOwnBusinessCompetitors,
} from '../../api/ai.js';

describe('resolveAgentReplyLanguage', () => {
  it('follows the latest spoken words, including mixed Khmer and English', () => {
    expect(resolveAgentReplyLanguage('សួស្តី', 'en')).toBe('Khmer');
    expect(resolveAgentReplyLanguage('Hello', 'km')).toBe('English');
    expect(resolveAgentReplyLanguage('សួស្តី Hello', 'km')).toBe('Mixed Khmer and English');
  });
});

describe('getVideoCaptionSpec', () => {
  it('creates a standard YouTube post with title and searchable description guidance', () => {
    const spec = getVideoCaptionSpec('YouTube');
    expect(spec.platform).toBe('YouTube');
    expect(spec.instruction).toContain('maximum 100 characters');
    expect(spec.instruction).toContain('searchable description');
  });

  it('falls back to TikTok for unknown client values', () => {
    expect(getVideoCaptionSpec('youtube')).toMatchObject({ platform: 'TikTok' });
  });
});

describe('resolveVideoAspectRatio', () => {
  it('keeps the requested portrait ratio while defaulting manual video to landscape', () => {
    expect(resolveVideoAspectRatio('16:9')).toBe('16:9');
    expect(resolveVideoAspectRatio('9:16')).toBe('9:16');
    expect(resolveVideoAspectRatio('4:3')).toBe('16:9');
  });
});

describe('video rate-limit policy', () => {
  it('keeps paid generation and polling out of the shared AI quota', () => {
    expect(getAiRateLimitPolicy('videoGenerate')).toMatchObject({
      scope: 'video-generate',
      ipScope: 'video-generate-ip',
      failClosed: true,
    });
    expect(getAiRateLimitPolicy('videoStatus')).toMatchObject({ scope: 'video-status', failClosed: false });
    expect(getAiRateLimitPolicy('geminiLiveToken')).toMatchObject({ scope: 'ai-live-voice', failClosed: false });
    expect(getAiRateLimitPolicy('geminiLiveToken').limit).toBeGreaterThan(10);
    expect(getAiRateLimitPolicy('copyGenerate')).toMatchObject({ scope: 'ai' });
    expect(getAiRateLimitPolicy('videoStatus').limit).toBeGreaterThan(80);
  });
});

describe('resolveCreativeImageMode', () => {
  it('preserves explicit poster requests through image automation', () => {
    expect(resolveCreativeImageMode('image', 'poster', 'create an image')).toBe('poster');
    expect(resolveCreativeImageMode('image', 'visual', 'ធ្វើជាទម្រង់ poster')).toBe('poster');
    expect(resolveCreativeImageMode('image', 'visual', 'create a normal product photo')).toBe('visual');
    expect(resolveCreativeImageMode('video', 'poster', 'poster')).toBe('visual');
  });
});

describe('resolveFacebookScanMode', () => {
  it('accepts the complete supported scanner target list', () => {
    const expectedModes = [
      'customer',
      'ai_interest',
      'market_trends',
      'high_value',
      'construction',
      'workers',
      'competitor_activity',
      'hiring',
    ];
    expect(FACEBOOK_SCAN_MODES).toEqual(expectedModes);
    for (const mode of expectedModes) {
      expect(resolveFacebookScanMode(mode)).toBe(mode);
    }
  });

  it('falls back safely when a client submits an unknown mode and no query to classify from', () => {
    expect(resolveFacebookScanMode('private_profiles')).toBe('customer');
    expect(resolveFacebookScanMode(undefined)).toBe('customer');
  });

  it('classifies an unset/auto mode from the free-text query instead of forcing a manual tab pick', () => {
    expect(resolveFacebookScanMode('auto', 'ក្រុមហ៊ុនកំពុងរើសបុគ្គលិក Sales')).toBe('hiring');
    expect(resolveFacebookScanMode(undefined, 'companies hiring marketing staff')).toBe('hiring');
    expect(resolveFacebookScanMode('', 'trend skincare Cambodia this week')).toBe('market_trends');
  });

  it('still honors an explicit manual tab selection over what the query text would suggest', () => {
    expect(resolveFacebookScanMode('customer', 'ក្រុមហ៊ុនកំពុងរើសបុគ្គលិក Sales')).toBe('customer');
  });
});

describe('classifyScanMode', () => {
  it('detects hiring intent before the broader competitor keyword', () => {
    expect(classifyScanMode('ក្រុមហ៊ុនកំពុងរើសបុគ្គលិក Marketing Manager')).toBe('hiring');
    expect(classifyScanMode('companies hiring sales staff')).toBe('hiring');
  });

  it('unifies competitor customers and seven-day activity into one competitor scan', () => {
    expect(classifyScanMode('អតិថិជនរបស់គូប្រកួត Page នេះ')).toBe('competitor_activity');
    expect(classifyScanMode('who are the customers of my competitor')).toBe('competitor_activity');
    expect(classifyScanMode('គូប្រកួត skincare Cambodia')).toBe('competitor_activity');
    expect(classifyScanMode('what did my competitor post this week')).toBe('competitor_activity');
    expect(resolveFacebookScanMode('competitor_customers')).toBe('competitor_activity');
  });

  it('detects trend, AI-interest, high-value, construction, and worker/freelancer intents', () => {
    expect(classifyScanMode('trend AI កម្ពុជា')).toBe('market_trends');
    expect(classifyScanMode('អាជីវកម្មចាប់អារម្មណ៍ AI និង automation')).toBe('ai_interest');
    expect(classifyScanMode('អចលនទ្រព្យ premium resort')).toBe('high_value');
    expect(classifyScanMode('ក្រុមហ៊ុនសំណង់ property developer Phnom Penh')).toBe('construction');
    expect(classifyScanMode('ជាងលាបថ្នាំ freelancer រកការងារ')).toBe('workers');
  });

  it('falls back to a general customer search when nothing matches', () => {
    expect(classifyScanMode('ភោជនីយដ្ឋានភ្នំពេញ')).toBe('customer');
    expect(classifyScanMode('')).toBe('customer');
    expect(classifyScanMode(undefined)).toBe('customer');
  });
});

describe('extractRequestedLeadCount', () => {
  it('reads a count typed directly in the query, in Khmer or English, either word order', () => {
    expect(extractRequestedLeadCount('ស្វែងរកអតិថិជន ១០ ក្រុមហ៊ុន')).toBe(10);
    expect(extractRequestedLeadCount('find 15 companies for skincare')).toBe(15);
    expect(extractRequestedLeadCount('top 20 leads for real estate')).toBe(20);
  });

  it('ignores an unrelated number and falls back to no explicit count', () => {
    expect(extractRequestedLeadCount('ភោជនីយដ្ឋានភ្នំពេញ')).toBe(0);
    expect(extractRequestedLeadCount('restaurant open since 2015')).toBe(0);
    expect(extractRequestedLeadCount('')).toBe(0);
  });

  it('rejects an implausibly large count instead of trusting it verbatim', () => {
    expect(extractRequestedLeadCount('find 500 companies')).toBe(0);
  });

  it('keeps a sane default cap for when no count is specified', () => {
    expect(DEFAULT_SCAN_ENTITY_CAP).toBeGreaterThan(0);
    expect(DEFAULT_SCAN_ENTITY_CAP).toBeLessThanOrEqual(25);
    expect(DEFAULT_COMPETITOR_ENTITY_CAP).toBe(50);
  });
});

describe('resolveCompetitorResearchTarget', () => {
  it('uses the Business Profile when the query is only a generic competitor-activity instruction', () => {
    expect(resolveCompetitorResearchTarget(
      'ស្វែងរកសកម្មភាពរបស់គូប្រកួតក្នុង ១ អាទិត្យ',
      'DGACADEMY',
    )).toBe('DGACADEMY');
    expect(resolveCompetitorResearchTarget(
      'find competitor activity from this week',
      'DGACADEMY',
    )).toBe('DGACADEMY');
  });

  it('preserves an explicit competitor or niche target', () => {
    expect(resolveCompetitorResearchTarget('skincare competitors Cambodia', 'DGACADEMY')).toBe('skincare competitors Cambodia');
    expect(resolveCompetitorResearchTarget('DGACADEMY competitors', 'DGACADEMY')).toBe('DGACADEMY competitors');
    expect(resolveCompetitorResearchTarget('ស្វែងរកគូប្រកួតប្រជែងរបស់Dating Cafe & Mart', 'DGACADEMY')).toBe('Dating Cafe & Mart');
    expect(resolveCompetitorResearchTarget('competitors of Dating Cafe & Mart', 'DGACADEMY')).toBe('Dating Cafe & Mart');
  });

  it('keeps Khmer subscript consonants and vowel signs in the target name', () => {
    expect(resolveCompetitorResearchTarget(
      'ស្វែងរកគូប្រកួតប្រជែងរបស់ MD ស្ក្រាប់ខាត់ស្បែកខ្លួន',
      'DGACADEMY',
    )).toBe('MD ស្ក្រាប់ខាត់ស្បែកខ្លួន');
  });

  it('strips a leading generic "company" word so the bare name matches the saved business name', () => {
    expect(resolveCompetitorResearchTarget(
      'ស្វែងរកគូប្រកួតប្រជែងរបស់ក្រុមហ៊ុន DGACADEMY',
      'DGACADEMY',
    )).toBe('DGACADEMY');
  });
});

describe('shouldReuseOwnBusinessCompetitors', () => {
  it('never substitutes profile competitors for a named target with no results', () => {
    expect(shouldReuseOwnBusinessCompetitors('Dating Cafe & Mart', 'DGACADEMY', 0)).toBe(false);
    expect(shouldReuseOwnBusinessCompetitors('DGACADEMY', 'DGACADEMY', 0)).toBe(true);
    expect(shouldReuseOwnBusinessCompetitors('DGACADEMY', 'DGACADEMY', 2)).toBe(false);
  });
});

describe('resolveAudienceResearchTarget', () => {
  it('extracts the named company from customer-audience requests', () => {
    expect(resolveAudienceResearchTarget('please tell me of my client of dating cafe & mart')).toBe('dating cafe & mart');
    expect(resolveAudienceResearchTarget('customers of Dating Cafe & Mart')).toBe('Dating Cafe & Mart');
    expect(resolveAudienceResearchTarget('customers of ABC Cafe')).toBe('ABC Cafe');
    expect(resolveAudienceResearchTarget('អតិថិជនរបស់ Dating Cafe & Mart')).toBe('Dating Cafe & Mart');
    expect(resolveAudienceResearchTarget('customers of my competitor')).toBe('');
    expect(resolveAudienceResearchTarget('អតិថិជនរបស់ https://www.facebook.com/ExampleBakery/')).toBe('https://www.facebook.com/ExampleBakery/');
    expect(resolveAudienceResearchTarget('https://facebook.com/ExampleBakery/?ref=share.')).toBe('https://facebook.com/ExampleBakery/?ref=share');
  });

  it('keeps Khmer subscript consonants and vowel signs in the target name', () => {
    expect(resolveAudienceResearchTarget('ស្កេងអតិថិជនរបស់ MD ស្ក្រាប់ខាត់ស្បែកខ្លួន')).toBe('MD ស្ក្រាប់ខាត់ស្បែកខ្លួន');
  });

  it('strips a leading generic "company" word so the bare name matches the saved business name', () => {
    expect(resolveAudienceResearchTarget('ស្វែងរកអតិថិជនរបស់ក្រុមហ៊ុន DGACADEMY')).toBe('DGACADEMY');
    expect(resolveAudienceResearchTarget('customers of the company DGACADEMY')).toBe('DGACADEMY');
  });
});

describe('isOwnBusinessNamedTarget', () => {
  it('recognizes the owner naming their own saved business, with or without a leading "company" word', () => {
    expect(isOwnBusinessNamedTarget('customers of Meadow Care', 'Meadow Care')).toBe(true);
    expect(isOwnBusinessNamedTarget('ស្វែងរកអតិថិជនរបស់ក្រុមហ៊ុន DGACADEMY', 'DGACADEMY')).toBe(true);
    expect(isOwnBusinessNamedTarget('DGACADEMY', 'DGACADEMY')).toBe(true);
  });
  it('does not match an unrelated company, a Page URL, or a missing business name', () => {
    expect(isOwnBusinessNamedTarget('customers of Another Shop', 'Meadow Care')).toBe(false);
    expect(isOwnBusinessNamedTarget('https://facebook.com/MeadowCare', 'Meadow Care')).toBe(false);
    expect(isOwnBusinessNamedTarget('customers of Meadow Care', '')).toBe(false);
  });
});

describe('resolveProductAudienceTarget', () => {
  const description = 'We make oat body lotion for dry skin and gift sets.';
  it('leaves a named self-reference for the lead-search path instead of aggregate research', () => {
    expect(resolveProductAudienceTarget('customers of Meadow Care', 'Meadow Care', description)).toBe('');
  });
  it('recognizes a product category already present in the saved description', () => {
    expect(resolveProductAudienceTarget('customers of body lotion', 'Meadow Care', description)).toBe('body lotion');
    expect(resolveProductAudienceTarget('body lotion', 'Meadow Care', description)).toBe('body lotion');
  });
  it('keeps unrelated companies and direct Page URLs on the exact-business path', () => {
    expect(resolveProductAudienceTarget('customers of Another Shop', 'Meadow Care', description)).toBe('');
    expect(resolveProductAudienceTarget('https://facebook.com/MeadowCare', 'Meadow Care', description)).toBe('');
  });
});

describe('findExactBusiness', () => {
  it('keeps only the requested business and accepts ampersand spelling', () => {
    const businesses = [
      { businessName: 'DGACADEMY' },
      { businessName: 'Dating Cafe and Mart' },
      { businessName: 'Dating App' },
    ];
    expect(findExactBusiness(businesses, 'Dating Cafe & Mart')).toBe(businesses[1]);
    expect(findExactBusiness(businesses, 'Unknown Cafe')).toBeNull();
  });

  it('matches the official Page name or exact Page URL without accepting a different Page', () => {
    const businesses = [
      { businessName: 'River Bakery', facebookPageName: 'River Bakery', facebookPageUrl: 'https://facebook.com/RiverBakery' },
      { businessName: 'City Bakes Ltd', facebookPageName: 'Example Bakery', facebookPageUrl: 'https://www.facebook.com/ExampleBakery/', sourceUrl: 'https://www.facebook.com/ExampleBakery/' },
    ];
    expect(findExactBusiness(businesses, 'Example Bakery')).toBe(businesses[1]);
    expect(findExactBusiness(businesses, 'https://m.facebook.com/ExampleBakery/?ref=share')).toBe(businesses[1]);
    expect(findExactBusiness(businesses, 'https://facebook.com/RiverBakery')).toBe(businesses[0]);
    expect(findExactBusiness(businesses, 'https://facebook.com/ExampleBakeries')).toBeNull();
  });
});

describe('getFacebookCompetitorActivityWindow', () => {
  it('returns exactly 7 calendar days ending on today in Cambodia time', () => {
    expect(getFacebookCompetitorActivityWindow(new Date('2026-09-13T18:30:00.000Z'))).toEqual({
      startDate: '2026-09-08',
      endDate: '2026-09-14',
    });
  });

  it('uses the selected market timezone instead of always using Cambodia time', () => {
    expect(getFacebookCompetitorActivityWindow(
      new Date('2026-09-14T03:30:00.000Z'),
      'America/New_York',
    )).toEqual({
      startDate: '2026-09-07',
      endDate: '2026-09-13',
    });
  });
});

// Regression coverage for the Content Plan feature (AIAgent.tsx's plan-upload
// UI + extractContentPlan action): a user pastes a Google Sheets link, and
// this is the piece that decides whether it's actually a Sheets link at all
// and, if so, builds the CSV export URL the server then fetches.
describe('googleSheetsUrlToCsvExportUrl', () => {
  it('converts a plain Google Sheets edit URL to its CSV export URL', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit';
    expect(googleSheetsUrlToCsvExportUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv',
    );
  });

  it('preserves a specific tab (gid) so the plan on that tab is what gets read', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=987654321';
    expect(googleSheetsUrlToCsvExportUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=987654321',
    );
  });

  it('handles a gid passed as a query parameter instead of a hash fragment', () => {
    const url = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit?gid=42';
    expect(googleSheetsUrlToCsvExportUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=42',
    );
  });

  it('returns null for a URL that is not a Google Sheets link', () => {
    expect(googleSheetsUrlToCsvExportUrl('https://example.com/my-plan.pdf')).toBeNull();
    expect(googleSheetsUrlToCsvExportUrl('')).toBeNull();
    expect(googleSheetsUrlToCsvExportUrl(undefined)).toBeNull();
  });
});

describe('ensureBusinessInInboxMessage', () => {
  it('introduces the saved business in every Khmer outreach message', () => {
    const result = ensureBusinessInInboxMessage('សួស្តីបង ខ្ញុំឃើញថាហាងមានឱកាសធ្វើវីដេអូខ្លី។', 'DGACADEMY');
    expect(result).toContain('ខ្ញុំមកពី DGACADEMY។');
    expect(result).toContain('ឱកាសធ្វើវីដេអូខ្លី');
  });

  it('does not duplicate a business name already present', () => {
    const message = 'សួស្តី! ខ្ញុំមកពី DGACADEMY។ យើងចង់សហការជាមួយអ្នក។';
    expect(ensureBusinessInInboxMessage(message, 'DGACADEMY')).toBe(message);
  });
});
