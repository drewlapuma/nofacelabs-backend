// api/generate-script.js  (CommonJS, Node 18+)

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;     // make sure this is set in Vercel
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-5-mini'; // or override if you want

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Decide "mode" based on storyType text.
 */
function classifyStoryType(storyTypeRaw) {
  const s = String(storyTypeRaw || '').toLowerCase();

  if (s.includes('scary'))        return 'scary';
  if (s.includes('urban'))        return 'urbanLegend';
  if (s.includes('bedtime'))      return 'bedtime';
  if (s.includes('what if'))      return 'whatIf';
  if (s.includes('history'))      return 'history';
  if (s.includes('fun fact'))     return 'funFacts';
  if (s.includes('philosophy'))   return 'philosophy';
  if (s.includes('motivational')) return 'motivational';
  if (s.includes('custom'))       return 'customPrompt';
  if (s.includes('random'))       return 'random';

  return 'generic';
}

/**
 * Build a style description for the model.
 */
function buildStyleHints(mode) {
  switch (mode) {
    case 'scary':
      return 'Write a creepy but Tiktok-safe horror story with suspense and a twist. No gore or graphic violence.';
    case 'urbanLegend':
      return 'Write it like a spooky urban legend people tell each other, with a mysterious or ambiguous ending.';
    case 'bedtime':
      return 'Write a calm, cozy, gentle bedtime story with a soft, reassuring ending. No horror or intense danger.';
    case 'whatIf':
      return 'Write a speculative “what if” scenario that explores interesting possibilities in a fun, imaginative way.';
    case 'history':
      return 'Write an interesting, easy-to-follow narrative about real or highly plausible historical events. Focus on a single theme or event.';
    case 'funFacts':
      return 'Write a fun narration that flows as a story but delivers multiple surprising and interesting facts around a single topic.';
    case 'philosophy':
      return 'Write a reflective, thought-provoking short story that explores a philosophical idea in a concrete, relatable way.';
    case 'motivational':
      return 'Write an inspiring story about struggle, growth, and eventual success, with a clear motivational takeaway.';
    case 'random':
      return 'Write any creative, surprising short story with a strong hook and satisfying ending.';
    case 'customPrompt':
      return 'Follow the user’s custom prompt strictly and turn it into a short, coherent narrative.';
    default:
      return 'Write a short, engaging narrative that is easy to follow and works well as a vertical video voiceover.';
  }
}

/**
 * Simple fallback generator if OpenAI fails.
 */
function fallbackStory({ storyType, artStyle, language, targetBeats }) {
  const mode = classifyStoryType(storyType);
  const base =
    mode === 'scary'
      ? 'A short scary story about something strange that happens one night.'
      : mode === 'bedtime'
      ? 'A calm bedtime story where everything ends peacefully.'
      : mode === 'history'
      ? 'A short narration about an interesting moment in history.'
      : mode === 'funFacts'
      ? 'A narration that shares several fun facts in a story-like way.'
      : 'A short motivational-style story about someone overcoming a challenge.';

  const beats = [];
  const count = targetBeats || 6;
  for (let i = 1; i <= count; i++) {
    beats.push({
      index: i,
      caption: `Beat ${i}`,
      imagePrompt: `${artStyle} style illustration of scene ${i} related to: ${base}`,
    });
  }

  return { narration: base, beats };
}

/**
 * Call OpenAI to generate narration + beats.
 */
async function callOpenAI({ storyType, artStyle, language, targetBeats, customPrompt }) {
  if (!OPENAI_API_KEY) {
    console.warn('[GENERATE_SCRIPT] Missing OPENAI_API_KEY, using fallback.');
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  const mode = classifyStoryType(storyType);
  const styleHints = buildStyleHints(mode);
  const beatsCount = targetBeats || 6;

  const userTopic =
    mode === 'customPrompt' && customPrompt
      ? `Base the story on this user prompt:\n"${customPrompt}"`
      : `Story type: ${storyType || 'Random AI story'}`;

  const prompt = `
You write short scripts for vertical videos (TikTok / Reels / Shorts).

${styleHints}

Language: ${language || 'English'}.
Number of beats (scenes): ${beatsCount}.

Each "beat" is one scene in the video.
For each beat, provide:
- caption: a very short title (2–5 words) for on-screen text.
- imagePrompt: a rich visual description for an AI image model.

Art style hint: ${artStyle || 'Realistic'}.
Make sure each imagePrompt mentions the mood and setting, and works in vertical 9:16 video.

${userTopic}

Return ONLY valid JSON in this exact shape:

{
  "narration": "full voiceover text for the whole video, 60–90 seconds when spoken",
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
            'You are a JSON-only API. Always return strictly valid JSON with no extra text.',
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
      imagePrompt: String(b.imagePrompt || `${artStyle} style illustration of beat ${i + 1}`),
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
      storyType   = 'Random AI story',
      artStyle    = 'Realistic',
      language    = 'English',
      targetBeats = 6,
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

