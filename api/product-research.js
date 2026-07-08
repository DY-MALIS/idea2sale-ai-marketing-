import { GoogleGenAI } from '@google/genai';

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
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;

  if (!query) {
    return res.status(400).json({ error: 'Please enter a product, niche, or URL to research.' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'Gemini API key is not configured.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: getPrompt(query, language),
    });

    return res.status(200).json({ analysis: response.text || '' });
  } catch (error) {
    console.error('Product research failed:', error);
    const message = String(error?.message || '');
    if (message.includes('API key expired') || message.includes('API_KEY_INVALID')) {
      return res.status(500).json({ error: 'Gemini API key expired. Please renew the API key and update GEMINI_API_KEY.' });
    }
    return res.status(500).json({ error: 'Error performing research. Please try again.' });
  }
}
