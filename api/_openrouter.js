const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const getApiKey = () => {
  const apiKey = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPEN_ROUTER_API_KEY is not configured in Vercel.');
  return apiKey;
};

const headers = (contentType = 'application/json') => ({
  Authorization: `Bearer ${getApiKey()}`,
  ...(contentType ? { 'Content-Type': contentType } : {}),
  'HTTP-Referer': process.env.APP_URL || 'https://aime.angkorgate.ai',
  'X-Title': 'aime.angkorgate',
});

const openRouterJson = async (path, body) => {
  const response = await fetch(`${OPENROUTER_BASE_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || 'OpenRouter request failed.');
  }

  return data;
};

const fileToDataUrl = (base64, mimeType) => `data:${mimeType};base64,${base64}`;

export async function generateOpenRouterText({ prompt, system = 'You are a helpful marketing assistant.', model, responseFormat }) {
  const apiKey = getApiKey();

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'https://aime.angkorgate.ai',
      'X-Title': 'aime.angkorgate',
    },
    body: JSON.stringify({
      model: model || process.env.OPEN_ROUTER_MODEL || 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || 'OpenRouter request failed.');
  }

  return data?.choices?.[0]?.message?.content || '';
}

export async function generateOpenRouterImage({ prompt, aspectRatio = '1:1', model }) {
  const data = await openRouterJson('/images', {
    model: model || process.env.OPEN_ROUTER_IMAGE_MODEL || 'bytedance-seed/seedream-4.5',
    prompt,
    aspect_ratio: aspectRatio,
    output_format: 'png',
    n: 1,
  });

  const image = data?.data?.[0];
  if (!image?.b64_json) throw new Error('OpenRouter did not return an image.');

  return {
    imageUrl: fileToDataUrl(image.b64_json, 'image/png'),
    usage: data?.usage,
  };
}

const speechModelCandidates = (model) => {
  const configured = model || process.env.OPEN_ROUTER_TTS_MODEL;
  return [
    configured,
    'openai/gpt-audio-mini',
    'openai/gpt-audio',
  ].filter(Boolean).filter((item, index, list) => list.indexOf(item) === index);
};

const isMissingModelError = (message) => /model .*does not exist|not a valid model id|no endpoints found|not found|unsupported model/i.test(message || '');
const isRetryableSpeechError = (message) => /provider returned error|did not return audio|temporarily unavailable|overloaded|rate limit/i.test(message || '');

const audioFromChatCompletion = (data) => {
  const message = data?.choices?.[0]?.message;
  const audio = message?.audio || message?.content?.find?.((item) => item?.type === 'output_audio')?.audio;
  const base64 = audio?.data || audio?.b64_json || audio?.base64;
  if (!base64) return null;
  const format = audio?.format || 'mp3';
  return {
    audioUrl: fileToDataUrl(base64, format === 'wav' ? 'audio/wav' : 'audio/mpeg'),
    transcript: audio?.transcript || message?.content,
  };
};

const audioFromStreamingText = (streamText) => {
  const audioChunks = [];
  const transcriptChunks = [];
  const errors = [];

  for (const line of String(streamText).split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;

    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const event = JSON.parse(payload);
      const choice = event?.choices?.[0];
      const audio = choice?.delta?.audio || choice?.message?.audio;
      const audioData = audio?.data || audio?.b64_json || audio?.base64;
      const transcript = audio?.transcript || choice?.delta?.content || choice?.message?.content;
      const errorMessage = event?.error?.message || event?.error || choice?.finish_reason;

      if (audioData) audioChunks.push(audioData);
      if (typeof transcript === 'string') transcriptChunks.push(transcript);
      if (typeof errorMessage === 'string' && errorMessage && errorMessage !== 'stop') errors.push(errorMessage);
    } catch {
      // Ignore keepalive or provider-specific stream lines that are not JSON.
    }
  }

  if (!audioChunks.length) {
    return errors.length ? { error: errors.join(' ') } : null;
  }

  return {
    audioUrl: fileToDataUrl(audioChunks.join(''), 'audio/mpeg'),
    transcript: transcriptChunks.join(''),
  };
};

const jsonFromMaybeText = (text) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
};

const containsKhmer = (text) => /[\u1780-\u17FF]/.test(text || '');

const splitLongSpeechText = (text, maxLength = 145) => {
  const chunks = [];
  let remaining = String(text || '').trim();

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const breakAt = Math.max(
      slice.lastIndexOf('។'),
      slice.lastIndexOf('!'),
      slice.lastIndexOf('?'),
      slice.lastIndexOf('.'),
      slice.lastIndexOf(','),
      slice.lastIndexOf(' '),
    );
    const cut = breakAt > 40 ? breakAt + 1 : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
};

const speechSegmentsForTranslate = (text) => {
  const tokens = String(text || '').match(/[\u1780-\u17FF]+|[A-Za-z0-9][A-Za-z0-9'._-]*|\s+|[^\sA-Za-z0-9\u1780-\u17FF]+/g) || [];
  const segments = [];

  for (const token of tokens) {
    const lang = containsKhmer(token) ? 'km' : 'en';
    const previous = segments[segments.length - 1];
    if (previous && previous.lang === lang) {
      previous.text += token;
    } else if (/^\s+$/.test(token) && previous) {
      previous.text += token;
    } else {
      segments.push({ lang, text: token });
    }
  }

  return segments
    .flatMap((segment) => splitLongSpeechText(segment.text).map((textChunk) => ({ ...segment, text: textChunk })))
    .filter((segment) => segment.text.trim());
};

const normalizeForKhmerSpeech = (text) => {
  const replacements = [
    [/\bDGACADEMY\b/gi, 'ឌីជី អាកាដេមី'],
    [/\bAI\b/g, 'អេ អាយ'],
    [/\bAPI\b/g, 'អេ ភី អាយ'],
    [/\bsystem\b/gi, 'ស៊ីស្ទឹម'],
    [/\bworkflow\b/gi, 'វើកហ្វ្លូ'],
    [/\baction\b/gi, 'អាក់សិន'],
    [/\bbuilder\b/gi, 'ប៊ីលឌឺ'],
    [/\bconcept\b/gi, 'ខនសេប'],
    [/\bupload\b/gi, 'អាប់ឡូត'],
    [/\bvideo\b/gi, 'វីដេអូ'],
    [/\bvoice\b/gi, 'វ៉យស៍'],
    [/\bmarketing\b/gi, 'ម៉ាឃីតធីង'],
    [/\bcontent\b/gi, 'ខនថិន'],
    [/\bbrand\b/gi, 'ប្រេន'],
  ];

  return replacements.reduce((value, [pattern, replacement]) => (
    value.replace(pattern, replacement)
  ), String(text || ''));
};

export async function generateTranslateSpeech({ input }) {
  const expressiveInput = normalizeForKhmerSpeech(input)
    .replace(/\s+/g, ' ')
    .replace(/([។.!?])\s*/g, '$1 ')
    .trim();
  const segments = speechSegmentsForTranslate(expressiveInput);
  if (!segments.length) throw new Error('Text is required.');

  const audioBuffers = [];
  for (const segment of segments) {
    const params = new URLSearchParams({
      ie: 'UTF-8',
      client: 'tw-ob',
      tl: segment.lang,
      ttsspeed: '2',
      q: segment.text,
    });
    const response = await fetch(`https://translate.google.com/translate_tts?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://translate.google.com/',
      },
    });

    if (!response.ok) {
      throw new Error(`Khmer TTS fallback failed with status ${response.status}.`);
    }

    audioBuffers.push(Buffer.from(await response.arrayBuffer()));
  }

  return {
    audioUrl: fileToDataUrl(Buffer.concat(audioBuffers).toString('base64'), 'audio/mpeg'),
    transcript: input,
    model: 'khmer-translate-tts-fallback',
  };
};

export async function generateOpenRouterSpeech({
  input,
  voice = 'alloy',
  model,
  speed = 1,
  languageHint = 'auto',
  performanceStyle = 'real human conversational speech, natural emotion, casual warmth, not AI narration',
}) {
  let lastError;

  for (const speechModel of speechModelCandidates(model)) {
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          model: speechModel,
          modalities: ['text', 'audio'],
          audio: {
            voice,
            format: 'mp3',
          },
          stream: true,
          messages: [
            {
              role: 'system',
              content: [
                `You are a real person speaking naturally at about ${speed}x speed with a fast but clear human conversational tempo.`,
                `The language mode is ${languageHint}.`,
                `Performance style: ${performanceStyle}.`,
                'Sound like a real human recorded in one take, with tiny imperfections, natural breath-like phrasing, and believable emotion.',
                'Speak faster than normal narration, with casual human rhythm, clear words, short natural pauses, and emphasis only where a person would naturally emphasize.',
                'Do not drag vowels, do not pause after every word, and do not use a slow audiobook or announcer cadence.',
                'Do not sound like AI narration, a robot, a formal announcer, a newsreader, a language learner, or someone reading letter by letter.',
                'For marketing copy, speak warmly and directly to one person, like a helpful creator explaining something in real life.',
                'If the text contains Khmer, pronounce the Khmer text as Khmer, not as English transliteration.',
                'If the text mixes Khmer and English, preserve each language pronunciation exactly as written.',
                'Do not read these instructions aloud. Return clear, clean audio only.',
              ].join(' '),
            },
            {
              role: 'user',
              content: `Text to read aloud:\n${input}`,
            },
          ],
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        const data = jsonFromMaybeText(responseText);
        throw new Error(data?.error?.message || data?.message || 'OpenRouter speech request failed.');
      }

      const audio = responseText.trim().startsWith('data:')
        ? audioFromStreamingText(responseText)
        : audioFromChatCompletion(jsonFromMaybeText(responseText));
      if (audio?.error) throw new Error(audio.error);
      if (!audio?.audioUrl) throw new Error('OpenRouter did not return audio.');

      return { ...audio, model: speechModel };
    } catch (error) {
      lastError = error;
      if (!isMissingModelError(error?.message) && !isRetryableSpeechError(error?.message)) break;
    }
  }

  throw lastError || new Error('OpenRouter speech request failed.');
}

export async function startOpenRouterVideo({ prompt, imageBase64, imageMimeType, model }) {
  const body = {
    model: model || process.env.OPEN_ROUTER_VIDEO_MODEL || 'google/veo-3.1',
    prompt,
    aspect_ratio: '16:9',
    resolution: '720p',
    duration: 8,
  };

  if (imageBase64 && imageMimeType) {
    body.input_references = [{ type: 'image_url', image_url: { url: fileToDataUrl(imageBase64, imageMimeType) } }];
  }

  const job = await openRouterJson('/videos', body);
  const jobId = job?.id;
  if (!jobId) throw new Error('OpenRouter did not return a video job id.');

  return { jobId, status: job.status, pollingUrl: job.polling_url };
}

export async function pollOpenRouterVideo({ jobId }) {
  const statusResponse = await fetch(`${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(jobId)}`, {
    headers: headers(null),
  });
  const status = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) {
    throw new Error(status?.error?.message || status?.message || 'OpenRouter video polling failed.');
  }
  if (status.status === 'failed' || status.status === 'cancelled' || status.status === 'expired') {
    throw new Error(status.error || `OpenRouter video generation ${status.status}.`);
  }
  if (status.status !== 'completed') {
    return { jobId, status: status.status, usage: status.usage };
  }

  const contentResponse = await fetch(`${OPENROUTER_BASE_URL}/videos/${encodeURIComponent(jobId)}/content?index=0`, {
    headers: headers(null),
  });
  if (!contentResponse.ok) {
    const data = await contentResponse.json().catch(() => ({}));
    throw new Error(data?.error?.message || data?.message || 'OpenRouter video download failed.');
  }
  const video = Buffer.from(await contentResponse.arrayBuffer()).toString('base64');
  return {
    videoUrl: fileToDataUrl(video, contentResponse.headers.get('content-type') || 'video/mp4'),
    jobId,
    status: status.status,
    usage: status.usage,
  };
}
