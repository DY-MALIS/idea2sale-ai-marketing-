import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Gemini API key is not configured.' });
  const query = String(req.body?.query || '').trim();
  const language = req.body?.language === 'km' ? 'Khmer' : 'English';
  if (!query) return res.status(400).json({ error: 'Product or category is required.' });
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create a concise digital advertising strategy for: "${query}". Write entirely in ${language}. Include target audience, three-second hooks, campaign structure, and a practical test budget. Do not invent live ad-account metrics.`,
    });
    return res.status(200).json({ strategy: response.text || 'No strategy generated.' });
  } catch (error) {
    const message = error?.message || 'Failed to generate strategy.';
    const expired = /expired|API_KEY_INVALID/i.test(message);
    return res.status(expired ? 503 : 500).json({ error: expired ? 'The Gemini API key is expired. Add a new GEMINI_API_KEY in Vercel.' : message });
  }
}
