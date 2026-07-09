import { generateOpenRouterText } from './_openrouter.js';

const promptByType = {
  caption: (prompt) => `Create a compelling social media caption based on: ${prompt}. Use strong hooks, clear benefits, and relevant hashtags.`,
  salepage: (prompt) => `Write a high-converting long-form sales page for: ${prompt}. Use the AIDA framework with clear sections and a strong call to action.`,
  script: (prompt) => `Create an engaging 60-second TikTok/Reels video script for: ${prompt}. Include visual scene directions and spoken dialogue.`,
  seo: (prompt) => `Generate 20 SEO keywords and a meta description for: ${prompt}. Target Google and social search intent.`,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const prompt = String(req.body?.prompt || '').trim();
  const contentType = String(req.body?.contentType || 'caption');
  const language = req.body?.language === 'km' ? 'Khmer' : 'English';
  if (!prompt) return res.status(400).json({ error: 'Please enter a campaign goal.' });

  const contentPrompt = promptByType[contentType]?.(prompt) || promptByType.caption(prompt);
  const fullPrompt = `You are an expert marketing copywriter.

${contentPrompt}

Language rules:
- The current application language is ${language}.
- Detect the language of the user's prompt: "${prompt}".
- If the prompt is Khmer or the application language is Khmer, write primarily in high-quality Khmer.
- Include English only when it helps global marketing reach.
- Use practical, ready-to-copy formatting.`;

  try {
    const text = await generateOpenRouterText({
      prompt: fullPrompt,
      system: 'You are an expert marketing copywriter.',
    });
    return res.status(200).json({ text: text || 'No response generated.' });
  } catch (error) {
    const message = String(error?.message || '');
    const keyError = /OPEN_ROUTER_API_KEY|unauthorized|invalid api key|permission/i.test(message);
    return res.status(keyError ? 503 : 500).json({
      error: keyError ? 'OpenRouter API key is missing or invalid. Update OPEN_ROUTER_API_KEY in Vercel.' : 'Error generating content. Please try again.',
    });
  }
}
