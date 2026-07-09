import { generateOpenRouterText } from './_openrouter.js';

const getPrompt = (query, language) => `You are an expert e-commerce product researcher. Analyze the following product, niche, or URL: "${query}".

Provide a concise but useful research report including:
1. Market Demand: current trend status and why people buy it.
2. Competitor Analysis: major players, offer style, and positioning.
3. Pricing Strategy: recommended price range and bundle ideas.
4. Target Audience: demographics, pain points, and buying triggers.
5. Winning Creative Angles: TikTok/video ad hooks and content ideas.

Language rules:
- The current application language is set to: ${language === 'km' ? 'Khmer' : 'English'}.
- Detect the language of the input: "${query}".
- If either the input is in Khmer OR the application language is Khmer, provide the entire report in Khmer.
- Otherwise, provide it in English.

Use clear headings and practical bullet points.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = String(req.body?.query || '').trim();
  const language = String(req.body?.language || 'en');

  if (!query) {
    return res.status(400).json({ error: 'Please enter a product, niche, or URL to research.' });
  }

  try {
    const analysis = await generateOpenRouterText({
      prompt: getPrompt(query, language),
      system: 'You are an expert e-commerce product researcher.',
    });
    return res.status(200).json({ analysis });
  } catch (error) {
    console.error('Product research failed:', error);
    const message = String(error?.message || '');
    if (/OPEN_ROUTER_API_KEY|unauthorized|invalid api key/i.test(message)) {
      return res.status(500).json({ error: 'OpenRouter API key is missing or invalid. Please update OPEN_ROUTER_API_KEY.' });
    }
    return res.status(500).json({ error: 'Error performing research. Please try again.' });
  }
}
