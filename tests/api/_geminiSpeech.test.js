import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGeminiSpeech } from '../../api/_geminiSpeech.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const stub = (result = Buffer.alloc(48000), ok = true, contentType = 'audio/pcm') => {
  vi.stubEnv('OPEN_ROUTER_API_KEY', 'test-server-key');
  const fetch = vi.fn().mockResolvedValue({ok,status:ok ? 200 : 400,headers:new Headers({'content-type':contentType,'x-generation-id':'test-generation'}),arrayBuffer:async()=>result,text:async()=>String(result)});
  vi.stubGlobal('fetch', fetch);return fetch;
};
describe('OpenRouter Gemini TTS adapter (mocked network)', () => {
  it('uses OpenRouter, preserves script and carries performance context', async () => {
    const fetch = stub();
    const result = await generateGeminiSpeech({input:'សួស្តី AI។',voice:'onyx',performanceStyle:'warm then excited',context:'Plan topic'});
    const [url,request] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(request.headers.Authorization).toBe('Bearer test-server-key');
    const body = JSON.parse(request.body);
    expect(body.input).toContain('SCRIPT:\nសួស្តី AI។');
    expect(body.input).toContain('warm then excited');
    expect(body.input).toContain('Plan topic');
    expect(body).toMatchObject({model:'google/gemini-3.1-flash-tts-preview',voice:'Charon',response_format:'pcm'});
    const wav = Buffer.from(result.audioUrl.split(',')[1],'base64');
    expect(wav.toString('ascii',0,4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(48044);
    expect(result).toMatchObject({duration:1,provider:'gemini',gateway:'openrouter',generationId:'test-generation'});
  });
  it('fails before a request when the dedicated server key is missing', async () => {
    const fetch=stub();vi.stubEnv('OPEN_ROUTER_API_KEY','');vi.stubEnv('OPENROUTER_API_KEY','');
    await expect(generateGeminiSpeech({input:'សួស្តី'})).rejects.toThrow('OPEN_ROUTER_API_KEY');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects text-only, corrupt and non-PCM responses without a fallback request', async () => {
    for (const [bytes, type] of [[Buffer.from('{}'),'application/json'],[Buffer.alloc(0),'audio/pcm'],[Buffer.alloc(1),'audio/pcm'],[Buffer.alloc(2),'audio/mpeg']]) {
      const fetch=stub(bytes,true,type);
      await expect(generateGeminiSpeech({input:'សួស្តី'})).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('redacts the configured key from provider errors and does not retry', async () => {
    const fetch=stub('invalid test-server-key',false);
    await expect(generateGeminiSpeech({input:'សួស្តី'})).rejects.toThrow('invalid [redacted]');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
