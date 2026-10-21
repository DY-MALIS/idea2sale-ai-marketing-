import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  checkRateLimit: vi.fn(),
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
});

it('reads only the signed-in profile links and uses verified Facebook Page evidence', async () => {
  admin.auth.mockReturnValue({ verifyIdToken: vi.fn().mockResolvedValue({ uid: 'other-company' }) });
  mocks.profiles['other-company'] = {
    websiteUrl: 'https://other.example.com',
    facebookPageUrl: 'https://www.facebook.com/profile.php?id=61512345678901',
  };
  mocks.extractWebsite.mockResolvedValue({ text: 'Other Company offers accounting and payroll services to businesses in Phnom Penh, with monthly reporting and consultations.', title: 'Other Company' });
  mocks.facebookRead.mockResolvedValue({ pageName: 'Other Company', pageUrl: mocks.profiles['other-company'].facebookPageUrl, text: 'Other Company shares payroll guidance and tax reminders for local businesses.', posts: [{ message: 'New payroll reporting service is available this month.' }] });
  mocks.text.mockResolvedValue('Other Company offers accounting and payroll services.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer company-token' }, body: {
    action: 'refreshBusinessKnowledge',
    websiteUrl: 'https://dgacademy.example.com',
    facebookPageUrl: 'https://www.facebook.com/dgacademy',
    language: 'en',
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://other.example.com' });
  expect(mocks.extractWebsite).not.toHaveBeenCalledWith({ url: 'https://dgacademy.example.com' });
  expect(mocks.facebookRead).toHaveBeenCalledWith(expect.anything(), 'other-company');
  expect(mocks.text.mock.calls[0][0].prompt).toContain('New payroll reporting service');
  expect(res.body.sources).toEqual(['https://other.example.com', mocks.profiles['other-company'].facebookPageUrl]);
});

it('rejects when no website, Facebook, or LinkedIn link is saved', async () => {
  const req = { method: 'POST', headers: {}, body: { action: 'refreshBusinessKnowledge', language: 'en' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(mocks.extractWebsite).not.toHaveBeenCalled();
  expect(mocks.text).not.toHaveBeenCalled();
});

it('fetches every saved link and distills a combined knowledge base', async () => {
  mocks.extractWebsite.mockImplementation(({ url }) => {
    if (url === 'https://dgacademy.example.com') {
      return Promise.resolve({ text: 'DG Academy teaches digital marketing, web development, and AI courses in Phnom Penh for working professionals who want to change careers.', title: 'DG Academy' });
    }
    if (url === 'https://www.facebook.com/dgacademy') {
      return Promise.resolve({ text: 'DG Academy | 5,000 likes. We run evening classes every week and offer a certificate on completion of each full course track.', title: 'DG Academy' });
    }
    return Promise.resolve({ text: '', title: '' });
  });
  mocks.text.mockResolvedValue('DG Academy is a training academy in Phnom Penh offering digital marketing, web development, and AI courses with evening classes and a completion certificate.');
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'refreshBusinessKnowledge',
      websiteUrl: 'https://dgacademy.example.com',
      facebookPageUrl: 'https://www.facebook.com/dgacademy',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://dgacademy.example.com' });
  expect(mocks.extractWebsite).toHaveBeenCalledWith({ url: 'https://www.facebook.com/dgacademy' });
  expect(mocks.text.mock.calls[0][0].prompt).toContain('digital marketing');
  expect(mocks.text.mock.calls[0][0].prompt).toContain('evening classes');
  expect(res.body).toEqual({
    businessKnowledgeBase: 'DG Academy is a training academy in Phnom Penh offering digital marketing, web development, and AI courses with evening classes and a completion certificate.',
    sources: ['https://dgacademy.example.com', 'https://www.facebook.com/dgacademy'],
  });
});

it('skips a link that comes back as login-wall/boilerplate-only text', async () => {
  mocks.extractWebsite.mockImplementation(({ url }) => {
    if (url === 'https://dgacademy.example.com') {
      return Promise.resolve({ text: 'DG Academy teaches digital marketing and web development courses for working professionals in Phnom Penh, with both morning and evening schedules.', title: 'DG Academy' });
    }
    // LinkedIn without a login session commonly returns only a short interstitial.
    return Promise.resolve({ text: 'Sign in to LinkedIn', title: 'LinkedIn Login' });
  });
  mocks.text.mockResolvedValue('DG Academy teaches digital marketing and web development courses.');
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'refreshBusinessKnowledge',
      websiteUrl: 'https://dgacademy.example.com',
      linkedinUrl: 'https://www.linkedin.com/company/dgacademy',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.sources).toEqual(['https://dgacademy.example.com']);
  expect(mocks.text.mock.calls[0][0].prompt).not.toContain('Sign in to LinkedIn');
});

it('tolerates one link failing to fetch as long as another succeeds', async () => {
  mocks.extractWebsite.mockImplementation(({ url }) => {
    if (url === 'https://dgacademy.example.com') {
      return Promise.reject(Object.assign(new Error('Could not reach this website.'), { status: 400 }));
    }
    return Promise.resolve({ text: 'DG Academy | Follow us for course updates and new class schedules every month, plus student project highlights and graduation photos.', title: 'DG Academy' });
  });
  mocks.text.mockResolvedValue('DG Academy posts course updates and new class schedules every month.');
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'refreshBusinessKnowledge',
      websiteUrl: 'https://dgacademy.example.com',
      facebookPageUrl: 'https://www.facebook.com/dgacademy',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.sources).toEqual(['https://www.facebook.com/dgacademy']);
});

it('returns 502 when every saved link fails or has no useful content', async () => {
  mocks.extractWebsite.mockResolvedValue({ text: 'Cookies. Privacy. Terms.', title: '' });
  const req = {
    method: 'POST',
    headers: {},
    body: { action: 'refreshBusinessKnowledge', websiteUrl: 'https://dgacademy.example.com', language: 'en' },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
  expect(mocks.text).not.toHaveBeenCalled();
});

it('returns 502 when the AI summary comes back empty', async () => {
  mocks.extractWebsite.mockResolvedValue({ text: 'DG Academy teaches digital marketing and web development courses in Phnom Penh for working professionals.', title: 'DG Academy' });
  mocks.text.mockResolvedValue('   ');
  const req = {
    method: 'POST',
    headers: {},
    body: { action: 'refreshBusinessKnowledge', websiteUrl: 'https://dgacademy.example.com', language: 'en' },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(502);
});
