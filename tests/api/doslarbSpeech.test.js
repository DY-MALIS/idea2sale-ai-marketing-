import { afterEach, expect, it, vi } from 'vitest';
import { generateDoslarbSpeech } from '../../api/_doslarbSpeech.js';
import { generateKhmerConversationSpeech, generateKhmerSpeech } from '../../api/_khmerNarration.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('requests a new Puthi MP3 for the provided script without exposing the API key', async () => {
  vi.stubEnv('DOSLARB_API_KEY', 'ds_sk_test');
  const bytes = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, {
    headers: { 'content-type': 'audio/mpeg', 'x-audio-duration-seconds': '6.24' },
  }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await generateDoslarbSpeech({ input: 'សូមស្វាគមន៍', voice: 'Female' });

  expect(fetchMock).toHaveBeenCalledWith('https://doslarb.cloud/api/v1/tts', expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({ Authorization: 'Bearer ds_sk_test' }),
    body: JSON.stringify({ text: 'សូមស្វាគមន៍', voice: 'puthi' }),
  }));
  expect(result).toMatchObject({ provider: 'doslarb', voice: 'puthi', duration: 6.24 });
  expect(result.audioUrl).toMatch(/^data:audio\/mpeg;base64,/);
  expect(JSON.stringify(result)).not.toContain('ds_sk_test');
});

it('uses Sovann for male narration and refuses a failed provider response', async () => {
  vi.stubEnv('DOSLARB_API_KEY', 'ds_sk_test');
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
  vi.stubGlobal('fetch', fetchMock);

  await expect(generateDoslarbSpeech({ input: 'សួស្តី', voice: 'Male' }))
    .rejects.toThrow('Doslarb Khmer speech failed (HTTP 429)');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).voice).toBe('sovann');
});

it('routes Khmer narration to the approved female provider when configured', async () => {
  vi.stubEnv('DOSLARB_API_KEY', 'ds_sk_test');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
    { headers: { 'content-type': 'audio/mpeg', 'x-audio-duration-seconds': '6.24' } },
  )));

  const result = await generateKhmerSpeech({ input: 'សូមស្វាគមន៍', voice: 'Female' });

  expect(result).toMatchObject({ provider: 'doslarb', voice: 'puthi', spokenText: 'សូមស្វាគមន៍' });
});

it('uses the clear Khmer voice for conversation when requested', async () => {
  vi.stubEnv('DOSLARB_API_KEY', 'ds_sk_test');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
    { headers: { 'content-type': 'audio/mpeg', 'x-audio-duration-seconds': '2.5' } },
  )));

  const result = await generateKhmerConversationSpeech({
    input: 'សួស្តី', voice: 'onyx', clearKhmerVoice: true,
  });

  expect(result).toMatchObject({ provider: 'doslarb', voice: 'sovann', spokenText: 'សួស្តី' });
});

it('does not substitute a weaker voice when clear Khmer speech fails', async () => {
  vi.stubEnv('DOSLARB_API_KEY', 'ds_sk_test');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

  await expect(generateKhmerConversationSpeech({
    input: 'សួស្តី', voice: 'Female', clearKhmerVoice: true,
  })).rejects.toThrow('Doslarb Khmer speech failed (HTTP 503)');
});

it('reports when the clear voice was requested without a server key', async () => {
  vi.stubEnv('DOSLARB_API_KEY', '');

  await expect(generateKhmerConversationSpeech({
    input: 'សួស្តី', voice: 'Female', clearKhmerVoice: true,
  })).rejects.toThrow('Clear Khmer voice is not configured on the server.');
});
