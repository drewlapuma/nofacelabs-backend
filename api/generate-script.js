// /api/generate-script.js  (CommonJS, Node 18+)

const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-5-mini'; // override in env if needed

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* -----------------------
   Story-type classification
------------------------ */
function classifyStoryType(storyTypeRaw) {
  const s = String(storyTypeRaw || '').trim().toLowerCase();

  // Normalize common labels from your UI
  if (s === 'interesting history' || s === 'history') return 'history';
  if (s.includes('urban legend')) return 'urbanLegend';
  if (s.includes('bedtime'))      return 'bedtime';
  if (s.includes('what if'))      return 'whatIf';
  if (s.includes('fun fact'))     return 'funFacts';
  if (s.includes('philosophy'))   return 'philosophy';
  if (s.includes('motivational')) return 'motivational';
  if (s.includes('custom'))       return 'customPrompt';
  if (s.includes('random'))       return 'random';
  if (s.includes('scary'))        return 'scary';

  return 'generic';
}

/* -----------------------
   Style hints to steer model
------------------------ */
function buildStyleHints(mode) {
  switch (mode) {
    case 'history':
      return 'Write an interesting, easy-to-follow narrative about a real historical event or figure. Keep it factual, specific, and engaging.';
    case 'urbanLegend':
      return 'Write a spooky urban-legend style tale with tension and a mysterious ending. No gore.';
    case 'bedtime':
      return 'Write a calm, cozy bedtime story with a gentle, reassuring ending.';
    case 'whatIf':
      return 'Write a speculative “what if” scenario, exploring surprising possibilities in a grounded, vivid way.';
    case 'funFacts':
      return 'Write a flowing narration that delivers several surprising, accurate facts around one topic, tied together with light storytelling.';
    case 'philosophy':
      return 'Write a reflective short story that illustrates a philosophical idea through concrete events.';
    case 'motivational':
      return 'Write an inspiring story about struggle, growth, and eventual success with a clear takeaway.';
    case 'scary':
      return 'Write a creepy but platform-safe scary story that relies on suspense and atmosphere. No gore.';
    case 'random':
      return 'Write a creative, surprising short story with a strong hook and satisfying ending.';
    default:
      return 'Write a short, engaging narrative that works well as a vertical video voiceover.';
  }
}

/* -----------------------
   Mode-specific fallback (no generic motivational default)
------------------------ */
function fallbackStory({ storyType, artStyle, language, targetBeats }) {
  const mode = classifyStoryType(storyType);

  const baseByMode = {
    history:      'A short narration about an interesting moment in history.',
    urbanLegend:  'A short spooky tale told as an urban legend with a mysterious ending.',
    bedtime:      'A calm bedtime story where everything ends peacefully.',
    whatIf:       'A speculative “what if” scenario exploring surprising possibilities.',
    funFacts:     'A narration that shares several fun facts in a story-like way.',
    philosophy:   'A reflective story exploring a philosophical idea in a concrete way.',
    motivational: 'A short motivational story about overcoming a challenge.',
    scary:        'A short scary story about something strange that happens one night.',
    random:       'A creative short story with a surprising hook and a neat ending.',
    generic:      'A short, engaging narrative suitable for a vertical video voiceover.'
  };

  const narration = baseByMode[mode] || baseByMode.generic;

  const beats = [];
  const count = Math.max(3, Number(targetBeats || 6));
  for (let i = 1; i <= count; i++) {
    beats.push({
      index: i,
      caption: `Beat ${i}`,
      imagePrompt: `${artStyle || 'Realistic'} style vertical 9:16 illustration of scene ${i} that fits: ${narration}. Include mood, setting, and action. No text overlay.`
    });
  }

  return { narration, beats };
}

/* -----------------------
   OpenAI call
------------------------ */
async function callOpenAI({ storyType, artStyle, language, targetBeats, customPrompt }) {
  if (!OPENAI_API_KEY) {
    console.warn('[GENERATE_SCRIPT] Missing OPENAI_API_KEY, using fallback.');
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  const mode       = classifyStoryType(storyType);
  const styleHints = buildStyleHints(mode);
  const beatsCount = Math.max(3, Number(targetBeats || 6));

  const userTopic =
    (mode === 'customPrompt' && customPrompt)
      ? `Base the story on this user prompt:\n"${String(customPrompt).trim()}"`
      : `Story type: ${storyType || 'Random AI story'}`;

  const prompt = `
You write short scripts for vertical videos (TikTok / Reels / Shorts).

${styleHints}

Language: ${language || 'English'}.
Number of beats (scenes): ${beatsCount}.

Each "beat" is one scene in the video.
For each beat, provide:
- caption: a very short title (2–5 words) for on-screen text.
- imagePrompt: a rich visual description for an AI image model (vertical 9:16, clear subject, setting, mood, lighting, and composition). No text overlay.

Art style hint: ${artStyle || 'Realistic'}.

${userTopic}

Return ONLY strict JSON in this exact shape:

{
  "narration": "full voiceover text for the whole video, ~60–90 seconds when spoken",
  "beats": [
    {
      "caption": "Short on-screen title",
      "imagePrompt": "Detailed visual description for this scene"
    }
  ]
}
  `.trim();

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a JSON-only API. Always return strictly valid JSON. Do not include any extra text.' },
        { role: 'user',   content: prompt }
      ],
      temperature: 0.9,
      // If your model supports it, this hardens JSON output:
      response_format: { type: 'json_object' }
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[GENERATE_SCRIPT] OpenAI error', resp.status, data);
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  const raw = data?.choices?.[0]?.message?.content?.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[GENERATE_SCRIPT] JSON parse failed, raw:', raw);
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  if (!parsed || typeof parsed.narration !== 'string' || !Array.isArray(parsed.beats)) {
    console.error('[GENERATE_SCRIPT] Parsed JSON missing fields:', parsed);
    return fallbackStory({ storyType, artStyle, language, targetBeats });
  }

  // Normalize beats
  const beats = parsed.beats
    .slice(0, beatsCount)
    .map((b, i) => ({
      index: i + 1,
      caption: String(b.caption || `Beat ${i + 1}`),
      imagePrompt: String(
        b.imagePrompt ||
        `${artStyle || 'Realistic'} style vertical 9:16 illustration of beat ${i + 1}`
      )
    }));

  return {
    narration: parsed.narration,
    beats,
  };
}

/* -----------------------
   HTTP handler
------------------------ */
module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = (typeof req.body === 'string')
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const {
      storyType    = 'Random AI story',   // supports: Random AI story, What if?, Bedtime Story, Interesting History, Urban Legends, Fun facts, Philosophy, Motivational, Scary, Custom Prompt
      artStyle     = 'Realistic',
      language     = 'English',
      targetBeats  = 6,
      customPrompt = ''
    } = body;

    const mode = classifyStoryType(storyType);
    console.log('[GENERATE_SCRIPT] INPUT', {
      storyType, mode, artStyle, language, targetBeats,
      hasCustomPrompt: !!customPrompt
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
