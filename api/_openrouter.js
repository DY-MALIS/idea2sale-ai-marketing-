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

export async function generateOpenRouterSpeech({ input, voice = 'alloy', model, speed = 1 }) {
  const response = await fetch(`${OPENROUTER_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: model || process.env.OPEN_ROUTER_TTS_MODEL || 'elevenlabs/eleven-turbo-v2',
      input,
      voice,
      response_format: 'mp3',
      speed,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || data?.message || 'OpenRouter speech request failed.');
  }

  const audio = Buffer.from(await response.arrayBuffer()).toString('base64');
  return { audioUrl: fileToDataUrl(audio, response.headers.get('content-type') || 'audio/mpeg') };
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
