export async function generateOpenRouterText({ prompt, system = 'You are a helpful marketing assistant.', model, responseFormat }) {
  const apiKey = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPEN_ROUTER_API_KEY is not configured in Vercel.');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
