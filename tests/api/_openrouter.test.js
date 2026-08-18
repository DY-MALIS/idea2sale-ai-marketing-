import { afterEach, describe, expect, it } from 'vitest';
import { resolveOpenRouterTextModel, resolveOpenRouterImageModel } from '../../api/_openrouter.js';

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
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
