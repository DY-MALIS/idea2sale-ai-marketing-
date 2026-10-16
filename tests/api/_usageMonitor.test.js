import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyAdmins: vi.fn(),
  synthesizeEdge: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock('../../api/_alert.js', () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock('../../api/_edgeSpeech.js', () => ({ synthesizeKhmerSpeechViaEdge: mocks.synthesizeEdge }));

import { runUsageChecks } from '../../api/_usageMonitor.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  // Neither the OpenRouter nor ImageKit key is configured in these tests --
  // both checks short-circuit to null (see their own `if (!key) return null`
  // guards), isolating each test to the one check it's actually exercising.
  vi.stubEnv('OPEN_ROUTER_API_KEY', '');
  vi.stubEnv('IMAGEKIT_PRIVATE_KEY', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('does not page admins when the Khmer voice synthesizes successfully', async () => {
  mocks.synthesizeEdge.mockResolvedValue({ audioUrl: 'data:audio/mpeg;base64,AA==', duration: 1 });
  const { warnings } = await runUsageChecks();
  expect(warnings).toEqual([]);
  expect(mocks.notifyAdmins).not.toHaveBeenCalled();
});

it('pages admins with an actionable message when Edge TTS fails, without blocking the other checks', async () => {
  mocks.synthesizeEdge.mockRejectedValue(new Error('Unexpected server response: 403'));
  const { warnings } = await runUsageChecks();
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('Unexpected server response: 403');
  expect(warnings[0]).toContain('github.com/SchneeHertz/node-edge-tts');
  expect(mocks.notifyAdmins).toHaveBeenCalledExactlyOnceWith(warnings[0]);
});

it('tests the real Edge TTS voice directly, not the Gemini-backed fallback', async () => {
  mocks.synthesizeEdge.mockResolvedValue({ audioUrl: 'data:audio/mpeg;base64,AA==', duration: 1 });
  await runUsageChecks();
  expect(mocks.synthesizeEdge).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ voice: 'km-KH-SreymomNeural' }));
});
