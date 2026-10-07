import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  text: vi.fn(),
  checkRateLimit: vi.fn(),
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
  initFirebaseAdmin: () => ({}),
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

import handler from '../../api/ai.js';

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

const textDataUrl = (text) => `data:text/plain;base64,${Buffer.from(text, 'utf8').toString('base64')}`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
});

it('returns an AI-created Content Planner in the chat instead of uploaded-plan items', async () => {
  mocks.text.mockResolvedValue('## Content Planner\n\n### Day 1 — 2026-10-10\nFacebook: Try our fresh coffee today.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'socialAgent', message: 'Create a content plan for my cafe', language: 'en' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.text).toContain('Facebook: Try our fresh coffee today.');
  expect(res.body.agentPlan).toBe(true);
  expect(res.body.planItems).toBeUndefined();
  expect(res.body.automation).toBeNull();
  expect(mocks.text).toHaveBeenCalledTimes(1);
});

it.each([
  ['voiceAutomationCheck', 'Create a 7 day content plan in Excel'],
  ['socialAgent', 'Create a 7 day content plan'],
])('returns an Excel document for a Live Voice plan through %s', async (action, message) => {
  mocks.text.mockImplementation(async ({ prompt }) => {
    const dates = prompt.match(/in this order: ([\d,\s-]+)/)?.[1].match(/\d{4}-\d{2}-\d{2}/g) || [];
    return JSON.stringify({ title: 'Sample plan', sheets: [{
      name: 'Plan', columns: ['Date', 'Platform', 'Format', 'Topic', 'Hook', 'CTA'],
      rows: dates.map((date) => [date, 'Facebook', 'Post', 'Helpful tip', 'Learn something useful', 'Message us']),
    }] });
  });
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action, message, liveVoice: true, detectedLanguage: 'en', language: 'en',
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.document).toMatchObject({ format: 'xlsx', sheets: [{ rows: expect.any(Array) }] });
  expect(res.body.document.sheets[0].rows).toHaveLength(7);
});

it('dates a new planner in the browser time zone near the UTC day boundary', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T18:30:00Z'));
  try {
    mocks.text.mockResolvedValue('## Content Planner\n\n### Day 1');
    const res = responseRecorder();
    await handler({ method: 'POST', headers: {}, body: {
      action: 'socialAgent', message: 'Create a content planner', language: 'en', timeZone: 'Asia/Bangkok',
    } }, res);
    expect(res.statusCode).toBe(200);
    expect(mocks.text.mock.calls[0][0].prompt).toContain("Today in the user's time zone (Asia/Bangkok): 2026-10-06");
  } finally {
    vi.useRealTimers();
  }
});

it('revises the AI-created planner in chat without editing the uploaded media calendar', async () => {
  const currentPlanner = '## Content Planner\n\n### Day 3\nFacebook: Coffee offer.';
  mocks.text.mockResolvedValue('## Content Planner\n\n### Day 3\nLinkedIn: Team story.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'socialAgent', message: 'Change day 3 to a LinkedIn team story', language: 'en',
    agentPlanText: currentPlanner,
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.agentPlan).toBe(true);
  expect(res.body.text).toContain('LinkedIn: Team story.');
  expect(res.body.planItems).toBeUndefined();
  expect(mocks.text).toHaveBeenCalledTimes(1);
  expect(mocks.text.mock.calls[0][0].prompt).toContain(currentPlanner);
});

it('recognizes a targeted "make day" follow-up as an edit to the AI planner', async () => {
  mocks.text.mockResolvedValue('## Content Planner\n\n### Day 3\nVideo: Team story.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'socialAgent', message: 'Make day 3 a video', language: 'en',
    agentPlanText: '## Content Planner\n\n### Day 3\nImage: Team story.',
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.agentPlan).toBe(true);
  expect(res.body.text).toContain('Video: Team story.');
});

it('prepares spoken audio text without misrouting it to image or video', async () => {
  mocks.text.mockResolvedValue('Visit our cafe for fresh coffee today.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'socialAgent', message: 'Generate a voiceover for my cafe', language: 'en' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.audioScript).toBe('Visit our cafe for fresh coffee today.');
  expect(res.body.automation).toBeNull();
  expect(mocks.text).toHaveBeenCalledTimes(1);
});

it('uses one fast reply call after a past media topic when the new question is ordinary chat', async () => {
  mocks.text.mockResolvedValue('Try a clear offer for repeat customers.');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'socialAgent', message: 'How can I sell more coffee?', language: 'en',
    history: [{ role: 'user', content: 'Create a video of coffee' }, { role: 'assistant', content: 'The video is starting.' }],
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.text).toBe('Try a clear offer for repeat customers.');
  expect(mocks.text).toHaveBeenCalledTimes(1);
  expect(mocks.text.mock.calls[0][0]).toMatchObject({ reasoningEffort: 'low', maxTokens: 1200 });
});

it('hands a complete image command to the generator after one classifier call', async () => {
  mocks.text.mockResolvedValue(JSON.stringify({
    ready: true, kind: 'image', imageMode: 'visual', platform: 'Facebook', aspectRatio: '1:1',
    prompt: 'Photorealistic cup of hot coffee on a wooden cafe table in morning light, no readable text anywhere',
    missing: '',
  }));
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'socialAgent', message: 'Create an image of a fresh coffee on a cafe table', language: 'en' } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.automation).toMatchObject({ ready: true, kind: 'image' });
  expect(res.body.text).toContain('Starting image generation');
  expect(mocks.text).toHaveBeenCalledTimes(1);
});

it('continues a video brief after the user answers the narration question', async () => {
  mocks.text.mockResolvedValue(JSON.stringify({
    ready: true, kind: 'video', platform: 'TikTok', aspectRatio: '9:16', duration: 8,
    prompt: 'Photorealistic Cambodian cafe worker pouring coffee in morning light, one continuous movement, no readable text',
    voiceOverWanted: true, voiceOverText: 'កាហ្វេស្រស់ពីហាងយើង ធ្វើឲ្យព្រឹករបស់អ្នកកាន់តែរីករាយ។', voiceGender: 'Female', missing: '',
  }));
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'socialAgent', message: 'With Khmer narration', language: 'en',
    history: [{ role: 'user', content: 'Create a video of coffee' }, { role: 'assistant', content: 'Do you want Khmer narration?' }],
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.automation).toMatchObject({ ready: true, kind: 'video', aspectRatio: '9:16', voiceOverText: expect.stringContaining('កាហ្វេ') });
  expect(mocks.text).toHaveBeenCalledTimes(1);
});

it('hands a completed spoken video command to the same generator brief', async () => {
  mocks.text.mockResolvedValue(JSON.stringify({
    ready: true, kind: 'video', platform: 'YouTube', duration: 8,
    prompt: 'Photorealistic Cambodian instructor demonstrating a training workflow in a classroom, no readable text',
    voiceOverWanted: true, voiceOverText: 'ស្វែងយល់ពីការប្រើ AI ក្នុងការងារប្រចាំថ្ងៃ។', voiceGender: 'Female', missing: '',
  }));
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'voiceAutomationCheck', message: 'Create a video about our training with Khmer narration',
    detectedLanguage: 'en',
  } }, res);

  expect(res.statusCode).toBe(200);
  expect(res.body.automation).toMatchObject({ ready: true, kind: 'video', aspectRatio: '16:9', duration: 8 });
});

it('returns the missing-detail question for an incomplete spoken video command', async () => {
  mocks.text.mockResolvedValue(JSON.stringify({
    ready: false, kind: 'video', platform: 'General',
    prompt: 'Photorealistic Cambodian instructor demonstrating a training workflow in a classroom, no readable text',
    voiceOverWanted: null, voiceOverText: '', missing: 'Should the video have Khmer narration or be silent?',
  }));
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'voiceAutomationCheck', message: 'Create a video about our training', detectedLanguage: 'en',
  } }, res);

  expect(res.body.automation).toMatchObject({ ready: false, kind: 'video', missing: 'Should the video have Khmer narration or be silent?' });
});

it('does not claim generation started while the automatic creation switch is off', async () => {
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: { action: 'socialAgent', message: 'Create an image of coffee', autoCreateEnabled: false } }, res);
  expect(res.body.automation).toBeNull();
  expect(res.body.text).toContain('Turn on Automatic image/video creation');
  expect(mocks.text).not.toHaveBeenCalled();
});

it('extracts a content plan from an uploaded PDF/Word/text file, not just CSV/Excel', async () => {
  mocks.text.mockResolvedValue(JSON.stringify([
    { date: '2026-10-10', type: 'image', topic: 'Grand opening', prompt: 'A bright storefront with a grand opening banner', headline: 'We are open!', cta: 'Visit us' },
  ]));
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'extractContentPlan',
      fileDataUrl: textDataUrl('Oct 10: grand opening post. Oct 12: behind-the-scenes video.'),
      fileName: 'content-brief.txt',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.items).toHaveLength(1);
  expect(res.body.items[0]).toMatchObject({ topic: 'Grand opening' });
  expect(mocks.text.mock.calls[0][0].prompt).toContain('grand opening');
});

it('retries a truncated extraction reply instead of reporting an empty plan', async () => {
  mocks.text.mockResolvedValueOnce('[{"date":"2026-10-10",').mockResolvedValueOnce(JSON.stringify([
    { date: '2026-10-10', type: 'image', topic: 'Opening', prompt: 'A bright storefront' },
  ]));
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'extractContentPlan', planText: '2026-10-10, Opening', language: 'en',
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.items).toHaveLength(1);
  expect(mocks.text).toHaveBeenCalledTimes(2);
});

it('returns an explicit error after two unreadable extraction replies', async () => {
  mocks.text.mockResolvedValue('[{"date":"2026-10-10",');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'extractContentPlan', planText: '2026-10-10, Opening', language: 'en',
  } }, res);
  expect(res.statusCode).toBe(502);
  expect(res.body.error).toMatch(/could not be read/i);
  expect(mocks.text).toHaveBeenCalledTimes(2);
});

it('retries a malformed provider JSON body but preserves provider failures', async () => {
  mocks.text.mockRejectedValueOnce(new SyntaxError('Unexpected end of JSON input')).mockResolvedValueOnce('[]');
  const req = { method: 'POST', headers: {}, body: {
    action: 'extractContentPlan', planText: 'Campaign notes without dates', language: 'en',
  } };
  const recovered = responseRecorder();
  await handler(req, recovered);
  expect(recovered.statusCode).toBe(200);
  expect(mocks.text).toHaveBeenCalledTimes(2);

  mocks.text.mockReset().mockRejectedValue(new Error('Provider unavailable'));
  const failed = responseRecorder();
  await handler(req, failed);
  expect(failed.statusCode).toBeGreaterThanOrEqual(500);
  expect(failed.body.error).toMatch(/Provider unavailable/);
  expect(mocks.text).toHaveBeenCalledTimes(1);
});

it('accepts a valid empty plan without an unnecessary retry', async () => {
  mocks.text.mockResolvedValue('[]');
  const res = responseRecorder();
  await handler({ method: 'POST', headers: {}, body: {
    action: 'extractContentPlan', planText: 'Campaign notes without dates', language: 'en',
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.items).toEqual([]);
  expect(mocks.text).toHaveBeenCalledTimes(1);
});

it('surfaces a document-extraction failure for a file type it cannot read', async () => {
  const req = {
    method: 'POST',
    headers: {},
    body: {
      action: 'extractContentPlan',
      // Real PNG magic bytes (not just a renamed text file) -- genuinely
      // binary content under an unrecognized/unreadable extension still
      // needs to be rejected, not decoded as garbled "text".
      fileDataUrl: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]).toString('base64')}`,
      fileName: 'plan-screenshot.png',
      language: 'en',
    },
  };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toMatch(/not supported/i);
  expect(mocks.text).not.toHaveBeenCalled();
});

it('still requires some source when neither text, a link, nor a file is sent', async () => {
  const req = { method: 'POST', headers: {}, body: { action: 'extractContentPlan', language: 'en' } };
  const res = responseRecorder();
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res.body.error).toMatch(/CSV, Excel, PDF, Word, or text file/i);
});
