import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOpenRouterTextModel, resolveOpenRouterImageModel, generateOpenRouterImage, redactSecrets } from '../../api/_openrouter.js';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

// Regression coverage for the "stale model in Vercel env vars" problem this
// session ran into: OPEN_ROUTER_MODEL/OPEN_ROUTER_AGENT_MODEL can be set to an
// old model name directly in Vercel, outside this repo entirely -- these
// resolvers exist specifically to catch and upgrade that case automatically
// rather than silently keep using a retired model forever.
describe('resolveOpenRouterTextModel', () => {
  it('falls back to the default reasoning model when nothing is configured', () => {
    delete process.env.OPEN_ROUTER_AGENT_MODEL;
    delete process.env.OPEN_ROUTER_MODEL;
    expect(resolveOpenRouterTextModel()).toBe('openai/gpt-5.6-luna');
  });

  it('passes through an explicit non-legacy model unchanged', () => {
    expect(resolveOpenRouterTextModel('anthropic/claude-opus-5')).toBe('anthropic/claude-opus-5');
  });

  it('upgrades a legacy 4o-mini/5-mini model name to the current default', () => {
    expect(resolveOpenRouterTextModel('openai/gpt-4o-mini')).toBe('openai/gpt-5.6-luna');
    expect(resolveOpenRouterTextModel('openai/gpt-5-mini')).toBe('openai/gpt-5.6-luna');
    expect(resolveOpenRouterTextModel('gpt-5-mini')).toBe('openai/gpt-5.6-luna');
  });

  it('upgrades a legacy model coming from an env var, not just an explicit argument', () => {
    process.env.OPEN_ROUTER_MODEL = 'openai/gpt-4o-mini';
    expect(resolveOpenRouterTextModel()).toBe('openai/gpt-5.6-luna');
  });
});

describe('resolveOpenRouterImageModel', () => {
  it('falls back to the default image model when nothing is configured', () => {
    delete process.env.OPEN_ROUTER_IMAGE_MODEL;
    expect(resolveOpenRouterImageModel()).toBe('bytedance-seed/seedream-5-0-pro');
  });

  it('passes through an explicit model unchanged', () => {
    expect(resolveOpenRouterImageModel('some/other-image-model')).toBe('some/other-image-model');
  });
});

// Regression coverage for the "app used to generate images, then a model swap
// broke it" scenario this session ran into: if the current default image
// model fails or returns no image data, one retry against the previously-
// stable model must happen automatically rather than the whole generation
// just failing.
describe('generateOpenRouterImage fallback', () => {
  const jsonResponse = (body, ok = true) => ({
    ok,
    json: async () => body,
  });

  it('returns the primary model image when the first call succeeds', async () => {
    process.env.OPEN_ROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: 'AAAA' }] }));
    global.fetch = fetchMock;

    const result = await generateOpenRouterImage({ prompt: 'a cat' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.imageUrl).toBe('data:image/png;base64,AAAA');
  });

  it('retries with the fallback model when the primary model errors', async () => {
    process.env.OPEN_ROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'model unavailable' } }, false))
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'BBBB' }] }));
    global.fetch = fetchMock;

    const result = await generateOpenRouterImage({ prompt: 'a dog', model: 'some/broken-model' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody.model).toBe('bytedance-seed/seedream-4.5');
    expect(result.imageUrl).toBe('data:image/png;base64,BBBB');
  });

  it('retries with the fallback model when the primary model returns no image data', async () => {
    process.env.OPEN_ROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{}] }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: 'CCCC' }] }));
    global.fetch = fetchMock;

    const result = await generateOpenRouterImage({ prompt: 'a bird' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.imageUrl).toBe('data:image/png;base64,CCCC');
  });

  it('still throws (after trying both models) when the fallback also fails', async () => {
    process.env.OPEN_ROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'all models down' } }, false));
    global.fetch = fetchMock;

    await expect(generateOpenRouterImage({ prompt: 'a fish' })).rejects.toThrow('all models down');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a second time when the primary model already is the fallback model', async () => {
    process.env.OPEN_ROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'down' } }, false));
    global.fetch = fetchMock;

    await expect(generateOpenRouterImage({ prompt: 'a fish', model: 'bytedance-seed/seedream-4.5' })).rejects.toThrow('down');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Regression coverage for a real incident this session: a secret pasted into
// the wrong Vercel env var (an API key value landing in a model-name field)
// made OpenRouter echo it back verbatim in an error message ("X is not a
// valid model ID"), which the app then displayed to a user and persisted into
// their AI Agent chat history in Firestore. redactSecrets is the guard
// against this ever leaking a real secret again, regardless of which env var
// it ends up in.
describe('redactSecrets', () => {
  it('redacts an OpenRouter-style key embedded in a longer message', () => {
    // Deliberately short/fake -- just long enough (16+ hex chars) to exercise
    // our own pattern without being anywhere near a real 64-char OpenRouter
    // key's length/shape (GitHub's push-protection secret scanner flags
    // anything matching that exact real shape, fake value or not).
    const fakeKeyFragment = 'sk-or-v1-' + '0123456789abcdef'.repeat(2);
    const message = `${fakeKeyFragment} is not a valid model ID`;
    expect(redactSecrets(message)).toBe('[redacted] is not a valid model ID');
  });

  it('redacts a Google API key (AIza...) style token', () => {
    // Deliberately fake -- matches the AIza<35 chars> shape, not a real key.
    expect(redactSecrets('key AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE rejected')).toBe('key [redacted] rejected');
  });

  it('redacts a Telegram-bot-token-shaped value', () => {
    // Deliberately fake -- matches the <digits>:<token> shape, not a real bot token.
    expect(redactSecrets('token 1234567890:FAKE-TOKEN-NOT-REAL-aaaaaaaaaaaaaaaaaaaa invalid')).toBe('token [redacted] invalid');
  });

  it('redacts any other long opaque token as a fallback', () => {
    const longToken = 'a'.repeat(45);
    expect(redactSecrets(`bad value ${longToken} here`)).toBe('bad value [redacted] here');
  });

  it('leaves ordinary error text with no secret-shaped substring untouched', () => {
    expect(redactSecrets('Model not found. Please try again.')).toBe('Model not found. Please try again.');
  });

  it('treats missing/nullish input as an empty string', () => {
    expect(redactSecrets(undefined)).toBe('');
    expect(redactSecrets(null)).toBe('');
  });
});
