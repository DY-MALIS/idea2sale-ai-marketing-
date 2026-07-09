import { generateOpenRouterText } from './_openrouter.js';

function parseJsonArray(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const month = String(req.body?.month || '');
  const language = req.body?.language === 'km' ? 'Khmer' : 'English';

  try {
    const text = await generateOpenRouterText({
      system: 'Return only valid JSON array. No markdown.',
      prompt: `Generate a high-converting social media content strategy for ${month}.
Create 8 diverse posts including educational content, product features, and engagement-driven posts.
Spread dates across the month.
Write titles in ${language}.
Return only JSON array items with title, platform (Facebook, TikTok, or Telegram), date (YYYY-MM-DD), time (HH:mm).`,
    });
    return res.status(200).json({ posts: parseJsonArray(text) });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'OpenRouter planner generation failed.' });
  }
}
