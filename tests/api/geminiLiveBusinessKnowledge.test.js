import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  checkRateLimit: vi.fn(),
  liveToken: vi.fn(),
  extractWebsite: vi.fn(),
  facebookRead: vi.fn(),
  profiles: {},
}));

vi.mock('../../api/_openrouter.js', () => ({
  generateOpenRouterImage: vi.fn(),
  generateOpenRouterSpeech: vi.fn(),
  generateOpenRouterText: mocks.text,
  generateTranslateSpeech: vi.fn(),
  pollOpenRouterVideo: vi.fn(),
  startOpenRouterVideo: vi.fn(),
  synthesizeSpeechViaOpenRouter: vi.fn(),
  transcribeAudioWithOpenRouter: vi.fn(),
  resolveOpenRouterTextModel: () => 'test-model',
  redactSecrets: (value) => String(value || ''),
}));
vi.mock('../../api/_khmerNarration.js', () => ({ createKhmerNarration: vi.fn(), generateKhmerConversationSpeech: vi.fn(), generateKhmerSpeech: vi.fn() }));
vi.mock('../../api/_videoSpeech.js', () => ({ preparePlanVideoSpeech: vi.fn() }));
vi.mock('../../api/_khmerVideo.js', () => ({ startKhmerVideoJob: vi.fn() }));
vi.mock('../../api/_firebaseAdmin.js', () => ({
  default: { auth: vi.fn() },
  initFirebaseAdmin: () => ({ collection: () => ({ doc: (uid) => ({ get: async () => ({ data: () => mocks.profiles[uid] || {} }) }) }) }),
}));
vi.mock('../../api/_rateLimit.js', () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: () => '127.0.0.1',
}));
vi.mock('../../api/_alert.js', () => ({ notifyAdmins: vi.fn() }));
vi.mock('../../api/_webBusinessSearch.js', () => ({ searchBusinessesOnWeb: vi.fn() }));
vi.mock('../../api/_competitorResearch.js', () => ({ researchCompetitors: vi.fn() }));
vi.mock('../../api/_marketTrendResearch.js', () => ({ researchMarketTrends: vi.fn() }));
vi.mock('../../api/_imagekitUpload.js', () => ({ uploadMediaDataUrl: vi.fn() }));
vi.mock('../../api/_email.js', () => ({ sendOutreachEmail: vi.fn() }));
vi.mock('../../api/_websiteExtract.js', () => ({ extractWebsiteText: mocks.extractWebsite }));
vi.mock('../../api/_facebook.js', () => ({ readProfileFacebookPage: mocks.facebookRead }));
vi.mock('../../api/_geminiLive.js', () => ({ createGeminiLiveEphemeralToken: mocks.liveToken }));

import handler from '../../api/ai.js';
import admin from '../../api/_firebaseAdmin.js';

const responseRecorder = () => {
  const response = {
    statusCode: 200,
    body: undefined,
    setHeader: vi.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  return response;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.profiles = {};
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.liveToken.mockResolvedValue({ token: 'test-token', model: 'gemini-test', voiceName: 'Aoede', systemInstruction: '' });
});

it('folds the saved business knowledge base into the Live Voice system instruction', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'geminiLiveToken',
      businessContext: {
        businessName: 'DG Academy',
        businessKnowledgeBase: 'DG Academy is a training academy in Phnom Penh offering digital marketing, web development, and AI courses with evening classes.',
      },
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.liveToken).toHaveBeenCalledTimes(1);
  const systemInstruction = mocks.liveToken.mock.calls[0][0].systemInstruction;
  expect(systemInstruction).toContain('DETAILED BUSINESS KNOWLEDGE');
  expect(systemInstruction).toContain('digital marketing, web development, and AI courses');
});

it('folds an uploaded document knowledge base into the Live Voice system instruction too', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'geminiLiveToken',
      businessContext: {
        businessName: 'DG Academy',
        businessDocumentKnowledge: 'DG Academy runs evening and weekend digital marketing, web development, and AI courses in Phnom Penh.',
      },
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  const systemInstruction = mocks.liveToken.mock.calls[0][0].systemInstruction;
  expect(systemInstruction).toContain('DETAILED BUSINESS KNOWLEDGE FROM AN UPLOADED DOCUMENT/LINK');
  expect(systemInstruction).toContain('digital marketing, web development, and AI courses');
  expect(systemInstruction).toContain('never a vague or generic non-answer');
});

it('omits the detailed knowledge block entirely when no knowledge base is saved yet', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: { action: 'geminiLiveToken', businessContext: { businessName: 'DG Academy' } },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  const systemInstruction = mocks.liveToken.mock.calls[0][0].systemInstruction;
  expect(systemInstruction).not.toContain('DETAILED BUSINESS KNOWLEDGE');
});

it('reads a public website for a Live Voice tool call', async () => {
  mocks.extractWebsite.mockResolvedValue({ url: 'https://example.com/about', title: 'About', text: 'We sell coffee.', links: ['https://example.com/contact'] });
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'liveWebsiteRead', url: 'https://example.com/about' } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://example.com/about' });
  expect(res.body).toMatchObject({ text: 'We sell coffee.', links: ['https://example.com/contact'] });
});

it('uses the saved website when a Live Voice tool call omits a URL', async () => {
  mocks.extractWebsite.mockResolvedValue({ url: 'https://example.com/', title: '', text: 'Open every day.', links: [] });
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'liveWebsiteRead', websiteUrl: 'https://example.com/' } }, res);
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://example.com/' });
  expect(res.statusCode).toBe(200);
});

it('uses the signed-in company website instead of a stale browser link for Live Voice', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'company_b' }) });
  mocks.profiles.company_b = { websiteUrl: 'https://company-b.example/' };
  mocks.extractWebsite.mockResolvedValue({ url: 'https://company-b.example/', title: 'Company B', text: 'Fresh coffee.', links: [] });
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-b-token' }, body: {
    action: 'liveWebsiteRead', websiteUrl: 'https://company-a.example/',
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://company-b.example/' });
});

it('puts the signed-in company links into the Live Agent instruction', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'company_b' }) });
  mocks.profiles.company_b = { businessName: 'Company B', facebookPageUrl: 'https://facebook.com/company_b', websiteUrl: 'https://company-b.example/', linkedinUrl: 'https://linkedin.com/company/company-b/' };
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-b-token' }, body: {
    action: 'geminiLiveToken', businessContext: { businessName: 'Old Company', facebookPageUrl: 'https://facebook.com/company_a' },
  } }, res);
  expect(res.statusCode).toBe(200);
  const instruction = mocks.liveToken.mock.calls.at(-1)[0].systemInstruction;
  expect(instruction).toContain('https://facebook.com/company_b');
  expect(instruction).toContain('https://company-b.example/');
  expect(instruction).toContain('https://linkedin.com/company/company-b/');
  expect(instruction).not.toContain('https://facebook.com/company_a');
  expect(instruction).toContain('Company B');
  expect(instruction).not.toContain('Old Company');
});

it('includes freshly read website facts in a text Agent answer', async () => {
  mocks.extractWebsite.mockResolvedValue({ url: 'https://example.com/', title: 'Shop', text: 'Open Monday to Friday, 9 am to 5 pm.', links: [] });
  mocks.text.mockResolvedValue('The shop is open Monday to Friday, 9 am to 5 pm.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'socialAgent', message: 'What are the shop hours?', businessContext: { websiteUrl: 'https://example.com/' } } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://example.com/' });
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('Open Monday to Friday, 9 am to 5 pm.');
});

it('tells the text Agent when the linked website could not be read', async () => {
  mocks.extractWebsite.mockRejectedValue(new Error('Website requires sign in.'));
  mocks.text.mockResolvedValue('I could not verify that page.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'socialAgent', message: 'Check https://example.com/ for prices.' } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('WEBSITE READ FAILED');
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('Do not claim you checked this website.');
});

it('reads this Google account’s Facebook posts and website for a Chat Agent content question', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'company_b' }) });
  mocks.profiles.company_b = { facebookPageUrl: 'https://facebook.com/company_b', websiteUrl: 'https://company-b.example/' };
  mocks.facebookRead.mockResolvedValue({ pageName: 'Company B', pageUrl: 'https://facebook.com/company_b', posts: [{ text: 'New coffee offer', publishedAt: '2026-10-20', url: 'https://facebook.com/company_b/posts/1' }], postsReadable: true });
  mocks.extractWebsite.mockResolvedValue({ url: 'https://company-b.example/', title: 'Company B', text: 'We sell coffee.', links: [] });
  mocks.text.mockResolvedValue('Company B recently promoted coffee.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-b-token' }, body: {
    action: 'socialAgent', message: 'What has our Facebook Page posted, and what content fits?',
    businessContext: { businessName: 'Company B', facebookPageUrl: 'https://facebook.com/old_company', websiteUrl: 'https://old-company.example/' },
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.facebookRead).toHaveBeenCalledWith(expect.any(Object), 'company_b');
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('New coffee offer');
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('We sell coffee.');
  expect(mocks.text.mock.calls.at(-1)[0].prompt).not.toContain('old-company.example');
});

it('reads the signed-in business Facebook Page before its saved link reaches the client', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'company_e' }) });
  mocks.profiles.company_e = { facebookPageUrl: 'https://facebook.com/company_e' };
  mocks.facebookRead.mockResolvedValue({ pageName: 'Company E', pageUrl: 'https://facebook.com/company_e', posts: [{ text: 'New course this week' }], postsReadable: true });
  mocks.text.mockResolvedValue('The Page posted about a new course.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-e-token' }, body: {
    action: 'socialAgent', message: 'What did our Facebook Page post?',
    businessContext: { businessName: 'Company E' },
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.facebookRead).toHaveBeenCalledWith(expect.any(Object), 'company_e');
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('New course this week');
});

it('does not invent Facebook posts when the Page cannot be read', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'company_c' }) });
  mocks.profiles.company_c = { facebookPageUrl: 'https://facebook.com/company_c' };
  mocks.facebookRead.mockRejectedValue(new Error('Facebook requires a connected Page.'));
  mocks.text.mockResolvedValue('I could not verify current posts.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-c-token' }, body: {
    action: 'socialAgent', message: 'What is our Facebook Page posting?',
    businessContext: { businessName: 'Company C', facebookPageUrl: 'https://facebook.com/company_c' },
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('FACEBOOK PAGE COULD NOT BE VERIFIED');
  expect(mocks.text.mock.calls.at(-1)[0].prompt).toContain('Do not claim to have seen its current posts');
});

it('uses the signed-in company’s linked posts when drafting a video content plan', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'company_d' }) });
  mocks.profiles.company_d = { facebookPageUrl: 'https://facebook.com/company_d', websiteUrl: 'https://company-d.example/' };
  mocks.facebookRead.mockResolvedValue({ pageName: 'Company D', posts: [{ text: 'Weekend bakery offer' }], postsReadable: true });
  mocks.extractWebsite.mockResolvedValue({ url: 'https://company-d.example/', text: 'Fresh bread and pastries.' });
  mocks.text
    .mockResolvedValueOnce('## Content Planner\n\n2026-10-22: Weekend bakery video')
    .mockResolvedValueOnce(JSON.stringify({ items: [{ date: '2026-10-22', type: 'video', topic: 'Weekend bakery', prompt: 'A Cambodian baker prepares fresh pastries inside a welcoming bakery.', voiceOverText: 'នំស្រស់របស់យើងរង់ចាំអ្នកនៅចុងសប្តាហ៍នេះ។' }] }));
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-d-token' }, body: {
    action: 'socialAgent', message: 'Create a video content plan for our bakery',
    businessContext: { businessName: 'Company D', facebookPageUrl: 'https://facebook.com/company_d', websiteUrl: 'https://company-d.example/' },
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.text.mock.calls[0][0].prompt).toContain('Weekend bakery offer');
  expect(mocks.text.mock.calls[0][0].prompt).toContain('Fresh bread and pastries.');
  expect(res.body.planItems).toMatchObject([{ type: 'video', topic: 'Weekend bakery' }]);
});
