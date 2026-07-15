import {
  generateOpenRouterImage,
  generateOpenRouterSpeech,
  generateOpenRouterText,
  pollOpenRouterVideo,
  startOpenRouterVideo,
} from './_openrouter.js';

const jsonFromText = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\[[\s\S]*\]|\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : fallback;
  }
};

const copyPromptByType = {
  caption: (prompt) => `Create a compelling social media caption based on: ${prompt}. Use strong hooks, clear benefits, and relevant hashtags.`,
  salepage: (prompt) => `Write a high-converting long-form sales page for: ${prompt}. Use the AIDA framework with clear sections and a strong call to action.`,
  script: (prompt) => `Create an engaging 60-second TikTok/Reels video script for: ${prompt}. Include visual scene directions and spoken dialogue.`,
  seo: (prompt) => `Generate 20 SEO keywords and a meta description for: ${prompt}. Target Google and social search intent.`,
};

const productResearchPrompt = (query, language) => `Analyze the following product, niche, or URL: "${query}".

Provide a concise but useful research report including market demand, competitors, pricing, target audience, and TikTok/video ad hooks.
Write in ${language === 'km' ? 'Khmer' : 'English'} when appropriate. Use clear headings and practical bullet points.`;

const photorealImagePrompt = (prompt) => `${prompt}

Photorealistic commercial image requirements:
- Make it look like a real camera photo, not an illustration, cartoon, 3D render, or plastic-looking AI image.
- Use natural realistic lighting, detailed shadows, accurate reflections, real material texture, sharp product edges, and believable depth of field.
- Use a premium product photography style with a real environment, realistic scale, natural imperfections, and lifelike color grading.
- If people appear, faces, hands, eyes, and skin must look anatomically correct and natural.
- Avoid distorted text, extra logos, malformed objects, duplicated limbs, fake watermarks, blurry details, oversaturated colors, and fantasy styling.
- Output should be high-detail, clean, professional, TikTok/e-commerce ready, and visually convincing.`;

const photorealVideoPrompt = (prompt) => `${prompt}

Photorealistic cinematic video requirements:
- Make the scene look filmed with a real camera, not animation, cartoon, or 3D render.
- Use realistic movement, natural camera motion, lifelike lighting, real shadows, accurate reflections, and believable object physics.
- Add subtle handheld or dolly movement, cinematic depth of field, natural motion blur, and smooth subject tracking.
- Product, people, hands, faces, and environment must stay consistent between frames with no warping or sudden identity changes.
- Avoid distorted text, melted objects, duplicated limbs, flickering, excessive saturation, impossible motion, and fantasy effects.
- Create a premium short-form ad style video suitable for TikTok, with a realistic product-demo feeling.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = String(req.body?.action || '');
  const languageCode = String(req.body?.language || 'en');
  const language = languageCode === 'km' ? 'Khmer' : 'English';

  try {
    if (action === 'copywriter') {
      const prompt = String(req.body?.prompt || '').trim();
      const contentType = String(req.body?.contentType || 'caption');
      if (!prompt) return res.status(400).json({ error: 'Please enter a campaign goal.' });
      const contentPrompt = copyPromptByType[contentType]?.(prompt) || copyPromptByType.caption(prompt);
      const text = await generateOpenRouterText({
        system: 'You are an expert marketing copywriter.',
        prompt: `${contentPrompt}\n\nWrite primarily in ${language}. Use practical, ready-to-copy formatting.`,
      });
      return res.status(200).json({ text: text || 'No response generated.' });
    }

    if (action === 'adsStrategy') {
      const query = String(req.body?.query || '').trim();
      if (!query) return res.status(400).json({ error: 'Product or category is required.' });
      const strategy = await generateOpenRouterText({
        system: 'You are a practical paid social advertising strategist.',
        prompt: `Create a concise digital advertising strategy for: "${query}". Write entirely in ${language}. Include target audience, three-second hooks, campaign structure, and a practical test budget. Do not invent live ad-account metrics.`,
      });
      return res.status(200).json({ strategy: strategy || 'No strategy generated.' });
    }

    if (action === 'productResearch') {
      const query = String(req.body?.query || '').trim();
      if (!query) return res.status(400).json({ error: 'Please enter a product, niche, or URL to research.' });
      const analysis = await generateOpenRouterText({
        system: 'You are an expert e-commerce product researcher.',
        prompt: productResearchPrompt(query, languageCode),
      });
      return res.status(200).json({ analysis });
    }

    if (action === 'plannerAuto') {
      const month = String(req.body?.month || '');
      const text = await generateOpenRouterText({
        system: 'Return only valid JSON array. No markdown.',
        prompt: `Generate a high-converting social media content strategy for ${month}. Create 8 diverse posts spread across the month. Write titles in ${language}. Return only JSON array items with title, platform (Facebook, TikTok, or Telegram), date (YYYY-MM-DD), time (HH:mm).`,
      });
      return res.status(200).json({ posts: jsonFromText(text, []) });
    }

    if (action === 'schedulerTrain') {
      const description = String(req.body?.description || '').trim();
      if (!description) return res.status(400).json({ error: 'Description is required.' });
      const text = await generateOpenRouterText({
        system: 'Return only valid JSON array. No markdown.',
        prompt: `Convert this audience activity description into an array of activity peaks: "${description}". Return only JSON array items with dayOfWeek, hour (0-23), intensity (0-1).`,
      });
      return res.status(200).json({ data: jsonFromText(text, []) });
    }

    if (action === 'schedulerSuggest') {
      const text = await generateOpenRouterText({
        system: 'Return only valid JSON array. No markdown.',
        prompt: `Analyze these audience activity logs and suggest the 5 best posting times. Reason must be in ${language}. Activity logs: ${JSON.stringify(req.body?.activityLogs || [])}. Return only JSON array items with dayOfWeek, hour, reason, score (0-1).`,
      });
      return res.status(200).json({ data: jsonFromText(text, []) });
    }

    if (action === 'schedulerDraft') {
      const platform = String(req.body?.platform || 'TikTok');
      const reason = String(req.body?.reason || '');
      const text = await generateOpenRouterText({
        prompt: `Generate a short, viral-ready social media post for ${platform}. Reason/context: "${reason}". Write entirely in ${language}. Include relevant hashtags. Return only the post copy.`,
      });
      return res.status(200).json({ text });
    }

    if (action === 'videoCaption') {
      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'Scene description is required.' });
      const text = await generateOpenRouterText({
        system: 'You are a social media expert who writes TikTok captions.',
        prompt: `Create a catchy TikTok caption and trending hashtags for this scene: "${prompt}". Write entirely in ${language}. Keep it ready to post.`,
      });
      return res.status(200).json({ text });
    }

    if (action === 'imageGenerate') {
      const prompt = String(req.body?.prompt || '').trim();
      const aspectRatio = String(req.body?.aspectRatio || '1:1');
      if (!prompt) return res.status(400).json({ error: 'Image prompt is required.' });
      const image = await generateOpenRouterImage({ prompt: photorealImagePrompt(prompt), aspectRatio });
      return res.status(200).json(image);
    }

    if (action === 'ttsGenerate') {
      const input = String(req.body?.input || '').trim();
      const voice = String(req.body?.voice || process.env.OPEN_ROUTER_TTS_VOICE || 'alloy');
      const speed = Number(req.body?.speed || 1);
      const languageHint = String(req.body?.languageHint || 'auto');
      if (!input) return res.status(400).json({ error: 'Text is required.' });
      const audio = await generateOpenRouterSpeech({ input, voice, speed, languageHint });
      return res.status(200).json(audio);
    }

    if (action === 'videoGenerate') {
      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'Video prompt is required.' });
      const video = await startOpenRouterVideo({
        prompt: photorealVideoPrompt(prompt),
        imageBase64: req.body?.imageBase64,
        imageMimeType: req.body?.imageMimeType,
      });
      return res.status(200).json(video);
    }

    if (action === 'videoStatus') {
      const jobId = String(req.body?.jobId || '').trim();
      if (!jobId) return res.status(400).json({ error: 'Video job id is required.' });
      const video = await pollOpenRouterVideo({ jobId });
      return res.status(200).json(video);
    }

    return res.status(400).json({ error: 'Unknown AI action.' });
  } catch (error) {
    const message = String(error?.message || '');
    const keyError = /OPEN_ROUTER_API_KEY|unauthorized|invalid api key/i.test(message);
    return res.status(keyError ? 503 : 500).json({
      error: keyError ? 'OpenRouter API key is missing or invalid. Update OPEN_ROUTER_API_KEY in Vercel.' : message || 'AI generation failed.',
    });
  }
}
