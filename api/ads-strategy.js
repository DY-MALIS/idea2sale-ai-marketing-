import { generateOpenRouterText } from './_openrouter.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = String(req.body?.query || '').trim();
  const language = req.body?.language === 'km' ? 'Khmer' : 'English';
  if (!query) return res.status(400).json({ error: 'Product or category is required.' });

  try {
    const strategy = await generateOpenRouterText({
      prompt: `Create a concise digital advertising strategy for: "${query}". Write entirely in ${language}. Include target audience, three-second hooks, campaign structure, and a practical test budget. Do not invent live ad-account metrics.`,
      system: 'You are a practical paid social advertising strategist.',
    });
    return res.status(200).json({ strategy: strategy || 'No strategy generated.' });
  } catch (error) {
    const message = error?.message || 'Failed to generate strategy.';
    const keyError = /OPEN_ROUTER_API_KEY|unauthorized|invalid api key/i.test(message);
    return res.status(keyError ? 503 : 500).json({ error: keyError ? 'Add a valid OPEN_ROUTER_API_KEY in Vercel.' : message });
  }
}
