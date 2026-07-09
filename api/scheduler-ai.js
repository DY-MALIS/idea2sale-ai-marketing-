import { generateOpenRouterText } from './_openrouter.js';

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : fallback;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = String(req.body?.action || '');
  const language = req.body?.language === 'km' ? 'Khmer' : 'English';

  try {
    if (action === 'train') {
      const description = String(req.body?.description || '').trim();
      if (!description) return res.status(400).json({ error: 'Description is required.' });
      const text = await generateOpenRouterText({
        system: 'Return only valid JSON. No markdown.',
        prompt: `Convert this audience activity description into an array of activity peaks.
Description: "${description}"
Return only JSON array items with dayOfWeek, hour (0-23), intensity (0-1).`,
      });
      return res.status(200).json({ data: parseJson(text, []) });
    }

    if (action === 'suggest') {
      const activityLogs = req.body?.activityLogs || [];
      const text = await generateOpenRouterText({
        system: 'Return only valid JSON. No markdown.',
        prompt: `Analyze these audience activity logs and suggest the 5 best posting times.
UI language: ${language}. Reason must be in ${language}.
Activity logs: ${JSON.stringify(activityLogs)}
Return only JSON array items with dayOfWeek, hour, reason, score (0-1).`,
      });
      return res.status(200).json({ data: parseJson(text, []) });
    }

    if (action === 'draft') {
      const platform = String(req.body?.platform || 'TikTok');
      const reason = String(req.body?.reason || '');
      const text = await generateOpenRouterText({
        prompt: `Generate a short, viral-ready social media post for ${platform}.
Reason/context: "${reason}"
Write entirely in ${language}. Include relevant hashtags. Return only the post copy.`,
      });
      return res.status(200).json({ text });
    }

    return res.status(400).json({ error: 'Unknown scheduler AI action.' });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'OpenRouter generation failed.' });
  }
}
