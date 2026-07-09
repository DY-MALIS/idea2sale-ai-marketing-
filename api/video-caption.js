import { generateOpenRouterText } from './_openrouter.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const prompt = String(req.body?.prompt || '').trim();
  const language = req.body?.language === 'km' ? 'Khmer' : 'English';
  if (!prompt) return res.status(400).json({ error: 'Scene description is required.' });

  try {
    const text = await generateOpenRouterText({
      system: 'You are a social media expert who writes TikTok captions.',
      prompt: `Create a catchy TikTok caption and trending hashtags for this scene: "${prompt}".
Write entirely in ${language}. Keep it ready to post.`,
    });
    return res.status(200).json({ text });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to generate caption.' });
  }
}
