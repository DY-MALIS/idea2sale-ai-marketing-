import {
  generateOpenRouterImage,
  generateOpenRouterSpeech,
  generateOpenRouterText,
  generateTranslateSpeech,
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

const productImageAnalysisPrompt = (language) => `You are a senior e-commerce visual merchandising and performance-ad creative analyst.
Analyze the attached product photo and produce a structured report covering four areas:

1. Visual & Technical Quality — composition/framing, lighting and color tone, background and staging, image sharpness, product angle and presentation.
2. Content & Message — what the product appears to be (likely name/category, materials, key visible features), styling cues, symbolism or mood, overall impression it creates.
3. Target Audience & Purpose — likely target audience (age, gender, interests, lifestyle), the buying intent this photo triggers, emotional appeal.
4. Marketing & Performance Potential — strengths of this photo for paid ads, weaknesses or fixes needed, recommended hook/CTA angle, and 2-3 ad hook ideas suited to this product.

Write the "analysis" field entirely in ${language}. Use short bold section headings with concise bullet points. Be specific and practical, not generic filler.

Respond with ONLY valid JSON, no markdown code fences, in exactly this shape:
{"productSummary": "short product/category name, max 8 words, in ${language}", "analysis": "the full structured report described above, formatted as plain text with line breaks"}`;

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

const agentSystemPrompt = `You are aime.angkorgate AI Agent, an intelligent conversational assistant for creators, sellers, and small businesses.
Your job is to understand any user request, keep useful context from the conversation, and answer like a sharp human expert who can explain, create, troubleshoot, plan, and advise.

Critical language contract:
- The language of the user's latest message is the only language that controls your reply.
- If the latest message contains Khmer characters, reply entirely in natural Khmer, even if the UI preference or older messages are English.
- If the latest message is English and contains no Khmer characters, reply entirely in English, even if the UI preference or older messages are Khmer.
- If the latest message intentionally mixes Khmer and English, keep the same mixed style naturally.
- Do not let previous assistant messages change the reply language.

Core behavior:
- Detect the user's real intent before answering: general question, content creation, troubleshooting, strategy, rewrite, translation, explanation, comparison, planning, or follow-up.
- Answer in the same language as the user's latest message. Khmer questions get natural Khmer. English questions get natural English. Mixed Khmer/English can stay mixed naturally.
- Use recent conversation context for follow-up questions such as "why?", "how?", "what next?", "make it shorter", or "change it to TikTok".
- Do not force every response into a marketing/content template. If the user asks a simple question, give a simple direct answer.
- If the user asks for content, create practical ready-to-use outputs for TikTok, Facebook, X, Telegram, or general marketing. Include hooks, captions, hashtags, scripts, angles, or plans only when they are useful for the request.
- If the user asks for troubleshooting, explain the likely cause, the exact fix, and the next action in a calm step-by-step way.
- If the user asks about the app, APIs, TikTok, Telegram, OpenRouter, Vercel, Firebase, or X, answer operationally and concretely.
- If important information is missing, ask one concise clarifying question. If a reasonable assumption is safe, state the assumption and continue.
- If current live data is needed and no API/context is available, say that clearly instead of pretending. You may still provide general guidance.
- Be concise by default, but provide complete answers when the task is complex.
- Avoid repeating the same wording or structure. Adapt the format to the user's request.
- Never invent private account data, API approvals, or external actions that were not actually confirmed.`;

const shouldUseXContext = (message) => {
  return /\b(x|twitter)\b|x\.com|tweet|post|trend|trending|news|ព័ត៌មាន|ព័ត៍មាន|ពេញនិយម/i.test(message);
};

const buildXSearchQuery = (message) => {
  return String(message)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b(x|twitter|x\.com|tweet|tweets|post|posts|trend|trending|news|from|latest|recent)\b/gi, ' ')
    .replace(/យក|ពី|មក|ផ្ទាល់|ព័ត៌មាន|ព័ត៍មាន|ពេញនិយម|ថ្មីៗ|ចុងក្រោយ/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
};

const fetchXContext = async (message) => {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken || !shouldUseXContext(message)) {
    return '';
  }

  const query = buildXSearchQuery(message) || 'marketing OR business OR AI lang:en';
  const params = new URLSearchParams({
    query: `${query} -is:retweet`,
    max_results: '10',
    'tweet.fields': 'created_at,public_metrics,lang,author_id',
    expansions: 'author_id',
    'user.fields': 'name,username',
  });

  try {
    const response = await fetch(`https://api.x.com/2/tweets/search/recent?${params.toString()}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    const data = await response.json();
    if (!response.ok) {
      return `X API context unavailable: ${data?.title || data?.detail || data?.error || response.statusText}`;
    }

    const users = new Map((data?.includes?.users || []).map((user) => [user.id, user]));
    const posts = (data?.data || []).slice(0, 8).map((post, index) => {
      const user = users.get(post.author_id);
      const metrics = post.public_metrics || {};
      return `${index + 1}. @${user?.username || 'unknown'}: ${post.text}
Likes: ${metrics.like_count || 0}, reposts: ${metrics.retweet_count || 0}, replies: ${metrics.reply_count || 0}, date: ${post.created_at || 'unknown'}`;
    });

    if (!posts.length) {
      return `X API returned no recent public posts for query: ${query}`;
    }

    return `Recent public X posts for query "${query}":
${posts.join('\n\n')}`;
  } catch (error) {
    return `X API context unavailable: ${error?.message || 'request failed'}`;
  }
};

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

    if (action === 'socialAgent') {
      const message = String(req.body?.message || '').trim();
      const platform = String(req.body?.platform || 'All');
      const mode = String(req.body?.mode || 'chat');
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
      if (!message) return res.status(400).json({ error: 'Please enter a question or content request.' });
      const detectedLanguage = String(req.body?.detectedLanguage || '').toLowerCase();
      const responseLanguage = detectedLanguage === 'km' || /[\u1780-\u17FF]/.test(message) ? 'Khmer' : 'English';

      const historyText = history
        .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${String(item.content || '').slice(0, 1200)}`)
        .join('\n');
      const xContext = await fetchXContext(message);

      const text = await generateOpenRouterText({
        system: agentSystemPrompt,
        prompt: `Detected user message language: ${responseLanguage}
UI language preference: ${language} (lower priority than the latest user message language)
Platform focus: ${platform}. If this is Auto, infer the platform from the user's wording. If no platform is mentioned, do not assume content is needed unless the user asks for content.
Mode: ${mode}. If this is auto, infer the user's intent and answer that intent only.

Recent conversation:
${historyText || 'None'}

X API context:
${xContext || 'No X API context was requested or available.'}

User request:
${message}

Respond in ${responseLanguage}. This is mandatory. If response language is Khmer, do not answer in English except for unavoidable product names, API names, hashtags, or code. If response language is English, do not answer in Khmer.

Response rules:
- Treat this as a real chat. Understand what the user wants before deciding the format.
- If it is a question: answer the question directly, then add the most useful next step only if helpful.
- If it is troubleshooting: give the likely cause, exact fix, and how to verify it worked.
- If it is content creation: provide only the content assets the user requested. If they did not specify format, suggest 2-3 good formats first.
- If it is a request to improve something: rewrite or improve it immediately, then briefly explain what changed.
- If it is a planning request: give a practical plan with clear steps and priorities.
- If it is casual conversation: respond naturally and do not turn it into a content plan.
- If X API context is available, use it as source inspiration and mention that the ideas are based on recent public X posts. Do not copy posts verbatim.
- If X API context says unavailable, explain the likely setup issue briefly and still answer with general guidance.
- If it is a follow-up: connect your answer to the previous messages.
- Do not repeat the same structure unless it fits the request.
- End with a useful next action only when it helps the user move forward.`,
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

    if (action === 'productImageAnalyze') {
      const imageBase64 = String(req.body?.imageBase64 || '').trim();
      const imageMimeType = String(req.body?.imageMimeType || 'image/jpeg');
      if (!imageBase64) return res.status(400).json({ error: 'Product image is required.' });
      const text = await generateOpenRouterText({
        system: 'You are a precise visual product analyst. Always respond with valid JSON only.',
        prompt: productImageAnalysisPrompt(language),
        imageBase64,
        imageMimeType,
      });
      const parsed = jsonFromText(text, {});
      const analysis = String(parsed.analysis || text || '').trim();
      const productSummary = String(parsed.productSummary || '').trim();
      if (!analysis) return res.status(502).json({ error: 'No analysis generated.' });
      return res.status(200).json({ analysis, productSummary });
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
      const performanceStyle = String(req.body?.performanceStyle || 'warm, expressive, natural, emotional human voice with realistic pauses');
      if (!input) return res.status(400).json({ error: 'Text is required.' });
      try {
        const audio = await generateOpenRouterSpeech({ input, voice, speed, languageHint, performanceStyle });
        return res.status(200).json(audio);
      } catch (error) {
        if (/[\u1780-\u17FF]/.test(input)) {
          const audio = await generateTranslateSpeech({ input });
          return res.status(200).json({
            ...audio,
            fallbackReason: error?.message || 'OpenRouter speech failed.',
          });
        }
        throw error;
      }
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
