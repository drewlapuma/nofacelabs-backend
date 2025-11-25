// api/generate-script.js  (CommonJS, Node 18+)

const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* --------- Story type classifier --------- */
function classifyStoryType(storyTypeRaw) {
  const s = String(storyTypeRaw || '').toLowerCase();

  if (s.includes('scary') || s.includes('horror')) return 'scary';
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

/* --------- Style hints --------- */
function buildStyleHints(mode) {
  switch (mode) {
    case 'scary':
      return `
Write a creepy but TikTok-safe horror narration.   
Focus on atmosphere, tension, shadows, whispers, eerie environments, unknown presence.  
Never focus on attractive people, selfies, portraits, or detailed faces.  
Keep the visuals environmental and mysterious.  
      `.trim();

    case 'urbanLegend':
      return `Write it like a spooky urban legend with a mysterious ending.`;

    case 'bedtime':
      return `Write a gentle, peaceful bedtime story.`;

    case 'whatIf':
      return `Write a speculative "what if" scenario that is fun and imaginative.`;

    case 'history':
      return `Write an engaging historical narration focused on one event.`;

    case 'funFacts':
      return `Write a fun narration delivering surprising facts as a flowing story.`;

    case 'philosophy':
      return `Write a reflective story that explores one philosophical idea.`;

    case 'motivational':
      return `Write an inspiring, uplifting story with a motivational takeaway.`;

    case 'random':
      return `Write a surprising but coherent creative short story.`;

    case 'customPrompt':
      return `Follow the user's custom prompt strictly.`;

    default:
      return `Write a simple, engaging narration for a vertical TikTok-style video.`;
  }
}

/* --------- Fallback if OpenAI fails --------- */
function fallbackNarration({ storyType }) {
  const mode = classifyStoryType(storyType);
  if (mode === 'scary') return 'A short eerie story about something strange happening one night.';
  if (mode === 'bedtime') return 'A calm bedtime story with a peaceful ending.';
  if (mode === 'history') return 'A short narration about an interesting historical moment.';
  if (mode === 'funFacts') return 'A narration delivering several fun facts.';
  if (mode === 'urbanLegend') return 'A spooky urban legend told as if it really happened.';
  if (mode === 'motivational') return 'A short motivational story.';
  return 'A short vertical-video narration.';
}

/* --------- Call OpenAI for narration --------- */
async function callOpenAI({ storyType, artStyle, language, customPrompt, durationRange }) {
  if (!OPENAI_API_KEY) {
    console.warn('[GENERATE_SCRIPT] No OPENAI_API_KEY – using fallback.');
    return { narration: fallbackNarration({ storyType }) };
  }

  console.log('[GENERATE_SCRIPT] Using OpenAI:', true);

  const mode       = classifyStoryType(storyType);
  const styleHints = buildStyleHints(mode);

  // Duration → word count
  let minSec = 60;
  let maxSec = 90;
  if (durationRange === '30-60') {
    minSec = 30;
    maxSec = 60;
  }

  // TikTok narration: ~2.4 words/sec → ~145 wpm
  const minWords = Math.round(minSec * 2.0);
  const maxWords = Math.round(maxSec * 2.6);

  const topic =
    mode === 'customPrompt' && customPrompt
      ? `Base the story STRICTLY on this:\n"${customPrompt}"`
      : storyType
      ? `Story type: ${storyType}`
      : 'Story type: Random AI Story';

  const prompt = `
You write narrations for vertical TikTok-style animated stories.

${styleHints}

- Language: ${language || 'English'}
- Art style preference: ${artStyle || 'Scary toon'}
- Length target: ${minSec}-${maxSec} seconds when spoken aloud  
  (~${minWords}-${maxWords} words)

Rules:
- Return ONLY valid JSON.
- The narration must be one continuous paragraph.
- NO scene numbers. NO beats. NO headings. NO bullet points.
- Strong visual imagery so each part naturally produces an image.
- Safe for TikTok.

Return EXACTLY this JSON shape:

{
  "narration": "full text here"
}

${topic}
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
        { role: 'system', content: 'You are a JSON-only API. Always return valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.9,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error('[GENERATE_SCRIPT] OpenAI error', resp.status, data);
    return { narration: fallbackNarration({ storyType }) };
  }

  const raw = data?.choices?.[0]?.message?.content?.trim() || '';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[GENERATE_SCRIPT] JSON parse failed:', raw);
    return { narration: fallbackNarration({ storyType }) };
  }

  if (!parsed?.narration || !parsed.narration.trim()) {
    console.error('[GENERATE_SCRIPT] Parsed JSON missing narration');
    return { narration: fallbackNarration({ storyType }) };
  }

  return { narration: parsed.narration.trim() };
}

/* --------- HTTP Handler --------- */
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const {
      storyType     = 'Random AI story',
      artStyle      = 'Scary toon',
      language      = 'English',
      customPrompt  = '',
      durationRange = '60-90',
    } = body;

    console.log('[GENERATE_SCRIPT] INPUT', {
      storyType,
      artStyle,
      language,
      durationRange,
      customPrompt: customPrompt?.slice?.(0, 60) || '',
      hasOpenAIKey: !!OPENAI_API_KEY,
    });

    const { narration } = await callOpenAI({
      storyType,
      artStyle,
      language,
      customPrompt,
      durationRange,
    });

    return res.status(200).json({
      storyType,
      artStyle,
      language,
      durationRange,
      narration,
    });
  } catch (err) {
    console.error('[GENERATE_SCRIPT] SERVER_ERROR', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: String(err?.message || err),
    });
  }
};
