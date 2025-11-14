// api/generate-script.js  (CommonJS, Node 18+)

const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;           // must be set in Vercel
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Fallback if OpenAI errors or returns garbage.
 * We now base it directly on storyType text instead of hard-wiring “scary” etc.
 */
function fallbackStory({ storyType, artStyle, language, targetBeats }) {
  const safeStoryType = String(storyType || 'Random AI story');
  const safeArt       = String(artStyle  || 'Realistic');
  const beatsCount    = targetBeats || 6;

  const baseNarration =
    `A short, engaging ${safeStoryType.toLowerCase()} suitable for a vertical video. ` +
    `Write it in ${language || 'English'}, clear and easy to follow.`;

  const beats = [];
  for (let i = 1; i <= beatsCount; i++) {
    beats.push({
      index: i,
      caption: `Beat ${i}`,
      imagePrompt: `${safeArt} style illustration of scene ${i} related to: ${safeStoryType}`,
    });
  }

  return { narration: baseNarration, beats };
}

/**
 * Call OpenAI to generate narration + beats, with NO internal “urbanLegend/scary” mode guessing.
 */
async function callOpenAI({ storyType, artStyle, language, targetBeats, customPrompt }) {
  if (!OPENAI_API_KEY) {
    console.warn('[GENERATE_SCRIPT] Missing OPENAI_API_KEY, using fallback.');
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  const beatsCount = targetBeats || 6;

  const safeStoryType = String(storyType || 'Random AI story');
  const safeArt       = String(artStyle  || 'Realistic');
  const safeLang      = String(language  || 'English');

  const userTopic = customPrompt && customPrompt.trim()
    ? `Base the story on this user prompt:\n"${customPrompt.trim()}"`
    : `Story type: ${safeStoryType}`;

  const prompt = `
You write short scripts for vertical videos (TikTok / Reels / Shorts).

Write a short, engaging narrative that fits this request:

- ${userTopic}
- Language: ${safeLang}
- Visual art style: ${safeArt}
- Length: roughly 60–90 seconds of spoken narration.
- Number of beats (scenes): ${beatsCount}

Each "beat" is one scene in the video.

For each beat, provide:
- caption: a very short on-screen title (2–5 words, no emojis).
- imagePrompt: a rich visual description for an AI image model.
  * Include mood, setting, and key subject.
  * Assume vertical 9:16 composition.
  * Do NOT mention text or captions inside the image.

Return ONLY valid JSON in this exact shape:

{
  "narration": "full voiceover text for the whole video",
  "beats": [
    {
      "caption": "Short on-screen title",
      "imagePrompt": "Detailed visual description for this scene"
    }
  ]
}
  `.trim();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a JSON-only API. Always return strictly valid JSON with no extra text, explanations, or markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.9,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error('[GENERATE_SCRIPT] OpenAI error', response.status, data);
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  const raw = data?.choices?.[0]?.message?.content?.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[GENERATE_SCRIPT] JSON parse failed, raw content:', raw);
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  if (!parsed || typeof parsed.narration !== 'string' || !Array.isArray(parsed.beats)) {
    console.error('[GENERATE_SCRIPT] Parsed JSON missing fields:', parsed);
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  // normalize beats
  const beats = parsed.beats
    .slice(0, beatsCount)
    .map((b, i) => ({
      index: i + 1,
      caption: String(b.caption || `Beat ${i + 1}`),
      imagePrompt: String(
        b.imagePrompt ||
          `${safeArt} style illustration of beat ${i + 1} related to: ${safeStoryType}`
      ),
    }));

  return {
    narration: parsed.narration,
    beats,
  };
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const {
      storyType    = 'Random AI story',
      artStyle     = 'Realistic',
      language     = 'English',
      targetBeats  = 6,
      customPrompt = '',
    } = body;

    console.log('[GENERATE_SCRIPT] INPUT', {
      storyType,
      artStyle,
      language,
      targetBeats,
      hasCustomPrompt: !!customPrompt,
    });

    const result = await callOpenAI({
      storyType,
      artStyle,
      language,
      targetBeats,
      customPrompt,
    });

    console.log('[GENERATE_SCRIPT] OUTPUT_PREVIEW', {
      narrationLen: (result.narration || '').length,
      beatCount: result.beats?.length || 0,
    });

    return res.status(200).json({
      storyType,
      artStyle,
      language,
      narration: result.narration,
      beats: result.beats,
    });
  } catch (err) {
    console.error('[GENERATE_SCRIPT] SERVER_ERROR', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: String(err?.message || err),
    });
  }
};
