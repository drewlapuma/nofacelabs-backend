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

/* --------- Style hints for the model --------- */
function buildStyleHints(mode) {
  switch (mode) {
    case 'scary':
      return 'Write a creepy but TikTok-safe horror story with suspense and a twist. No gore or graphic violence.';
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

/* --------- Fallback if OpenAI fails --------- */
function fallbackNarration({ storyType }) {
  const mode = classifyStoryType(storyType);

  if (mode === 'scary') {
    return 'A short scary story about something strange that happens one night.';
  }
  if (mode === 'bedtime') {
    return 'A calm bedtime story where everything ends peacefully.';
  }
  if (mode === 'history') {
    return 'A short narration about an interesting moment in history.';
  }
  if (mode === 'funFacts') {
    return 'A narration that shares several fun facts in a story-like way.';
  }
  if (mode === 'urbanLegend') {
    return 'A spooky urban legend told as if it really happened in a small town.';
  }
  if (mode === 'philosophy') {
    return 'A reflective story that explores a big life question through a simple event.';
  }
  if (mode === 'motivational') {
    return 'A short motivational-style story about someone overcoming a challenge.';
  }

  // generic / random
  return 'A short, engaging story that works well as a vertical video voiceover.';
}

/* --------- Call OpenAI: narration ONLY --------- */
async function callOpenAI({ storyType, artStyle, language, customPrompt, durationRange }) {
  if (!OPENAI_API_KEY) {
    console.warn('[GENERATE_SCRIPT] Missing OPENAI_API_KEY, using fallback narration.');
    return { narration: fallbackNarration({ storyType }) };
  }

  const mode       = classifyStoryType(storyType);
  const styleHints = buildStyleHints(mode);

  // Map durationRange -> target seconds & words
  let minSec = 60;
  let maxSec = 90;
  if (durationRange === '30-60') {
    minSec = 30;
    maxSec = 60;
  }

  // Simple words-per-second estimate (about 2.5 words/sec = 150 wpm)
  const minWords = Math.round(minSec * 2.0);  // slightly under so we don’t overshoot
  const maxWords = Math.round(maxSec * 2.8);  // upper bound

  const userTopic =
    mode === 'customPrompt' && customPrompt
      ? `Base the story on this user prompt:\n"${customPrompt}"`
      : storyType
      ? `Story type: ${storyType}`
      : 'Story type: Random AI story';

  const prompt = `
You write short scripts for vertical videos (TikTok / Reels / Shorts).

${styleHints}

- Language: ${language || 'English'}.
- Art style preference: ${artStyle || 'Realistic'}.
- Length: The narration should be about ${minSec}–${maxSec} seconds when spoken at a natural pace.
  That is roughly ${minWords}–${maxWords} words.

Do NOT break the script into beats. Just write one continuous narration that can be read as a single voiceover track.

Return ONLY valid JSON in this exact shape:

{
  "narration": "full voiceover text for the whole video"
}

${userTopic}
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

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error('[GENERATE_SCRIPT] OpenAI error', resp.status, data);
    return { narration: fallbackNarration({ storyType }) };
  }

  const raw = data?.choices?.[0]?.message?.content?.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[GENERATE_SCRIPT] JSON parse failed, raw content:', raw);
    return { narration: fallbackNarration({ storyType }) };
  }

  if (!parsed || typeof parsed.narration !== 'string' || !parsed.narration.trim()) {
    console.error('[GENERATE_SCRIPT] Parsed JSON missing narration:', parsed);
    return { narration: fallbackNarration({ storyType }) };
  }

  return { narration: parsed.narration.trim() };
}

/* --------- HTTP handler --------- */
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
      storyType     = 'Random AI story',
      artStyle      = 'Realistic',
      language      = 'English',
      customPrompt  = '',
      durationRange = '60-90',       // <-- NEW: matches what we send from the frontend
    } = body;

    console.log('[GENERATE_SCRIPT] INPUT', {
      storyType,
      artStyle,
      language,
      durationRange,
      hasCustomPrompt: !!customPrompt,
    });

    const { narration } = await callOpenAI({
      storyType,
      artStyle,
      language,
      customPrompt,
      durationRange,
    });

    console.log('[GENERATE_SCRIPT] OUTPUT_PREVIEW', {
      narrationLen: (narration || '').length,
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
