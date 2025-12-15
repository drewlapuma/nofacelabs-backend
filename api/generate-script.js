// api/generate-script.js (CommonJS, Node 18+)

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* --------- Story type classifier --------- */
function classifyStoryType(storyTypeRaw) {
  const s = String(storyTypeRaw || '').toLowerCase();

  if (s.includes('scary')) return 'scary';
  if (s.includes('urban')) return 'urbanLegend';
  if (s.includes('bedtime')) return 'bedtime';
  if (s.includes('what if')) return 'whatIf';
  if (s.includes('history')) return 'history';
  if (s.includes('fun fact')) return 'funFacts';
  if (s.includes('philosophy')) return 'philosophy';
  if (s.includes('motivational')) return 'motivational';
  if (s.includes('custom')) return 'customPrompt';
  if (s.includes('random')) return 'random';

  return 'generic';
}

/* --------- Style / narration hints for the model --------- */
function buildStyleHints(mode) {
  switch (mode) {
    case 'scary':
      return [
        'Write a creepy horror story with suspense and a twist.',
        'Tell the story as a sequence of very visual moments the viewer could actually see.',
        'In most sentences, describe concrete things in the scene: environment, lighting, objects, silhouettes,',
        'Avoid vague lines like "it felt scary" unless attached to a clear visual detail.',
        'Do NOT default to the same tropes (alley, streetlamp, abandoned house, 3:00 AM, static on TV) unless explicitly requested.',
      ].join(' ');
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
    return 'The elevator doors opened to a floor that didn’t exist on the directory, and the hallway lights blinked as if they were breathing.';
  }
  if (mode === 'bedtime') {
    return 'A calm bedtime story where the stars watch over a small, sleepy village and everything ends peacefully.';
  }
  if (mode === 'history') {
    return 'A short narration about an interesting moment in history, told in a simple, story-like way.';
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

  return 'A short, engaging story that works well as a vertical video voiceover.';
}

/* --------- Variety hooks --------- */
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildVarietyHook(mode) {
  // These hooks force different “starting frames” so stories stop feeling identical.
  const scarySettings = [
    'a bright grocery store at closing time',
    'a packed movie theater during the trailers',
    'a suburban kitchen during a thunderstorm',
    'a school hallway after a pep rally',
    'a motel ice machine room',
    'a crowded bus at night',
    'a laundromat with humming fluorescent lights',
    'a hospital waiting room with a broken TV',
    'a hiking trail parking lot at sunrise',
    'a library basement archive room',
  ];

  const genericSettings = [
    'a small town main street',
    'a train station platform',
    'a quiet apartment hallway',
    'a beach boardwalk',
    'a warehouse office',
  ];

  const setting = mode === 'scary' ? pickOne(scarySettings) : pickOne(genericSettings);
  return `Start in this setting (do not ignore it): ${setting}.`;
}

/* --------- Call OpenAI: narration ONLY --------- */
async function callOpenAI({ storyType, artStyle, language, customPrompt, durationRange }) {
  const mode = classifyStoryType(storyType);
  const styleHints = buildStyleHints(mode);

  if (!OPENAI_API_KEY) {
    console.warn('[GENERATE_SCRIPT] Missing OPENAI_API_KEY -> using fallback narration.');
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  // durationRange -> seconds & words
  let minSec = 60;
  let maxSec = 90;
  if (durationRange === '30-60') {
    minSec = 30;
    maxSec = 60;
  }

  // words-per-second estimate
  const minWords = Math.round(minSec * 2.0);
  const maxWords = Math.round(maxSec * 2.8);

  const userTopic =
    mode === 'customPrompt' && customPrompt
      ? `Base the story on this user prompt:\n"${customPrompt}"`
      : storyType
      ? `Story type label: ${storyType}`
      : 'Story type label: Random AI story';

  const varietyHook = buildVarietyHook(mode);

  const antiRepetitionRules = `
Anti-repetition rules:
- Do not reuse the same core setup from previous stories (no repeated streetlamp/alley/abandoned-house defaults).
- Vary: setting, time of day, protagonist, and the “strange object” that triggers events.
- Avoid the phrases: "it felt like", "I couldn't believe", "I knew I shouldn't", unless tied to a visible action.
`.trim();

  const extraVisualRules = `
Global rules:
- This will be turned into illustrated scenes.
- Favor concrete visual description over abstract feelings.
- In most sentences mention: environment, lighting, important objects, and motion.
`.trim();

  const prompt = `
You write short scripts for vertical videos (TikTok / Reels / Shorts).

${styleHints}

${varietyHook}

${antiRepetitionRules}

${extraVisualRules}

- Language: ${language || 'English'}.
- Art style preference (for visuals only): ${artStyle || 'Realistic'}.
- Length: ${minSec}–${maxSec} seconds spoken, roughly ${minWords}–${maxWords} words.

Do NOT break the script into bullet points or numbered beats.
Write ONE continuous narration for a single voiceover track.

Return ONLY valid JSON in this exact shape:
{
  "narration": "full voiceover text for the whole video"
}

${userTopic}
`.trim();

  let resp;
  let data;
  try {
    resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'You are a JSON-only API. Always return strictly valid JSON with no extra text.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.9,
        top_p: 0.95,
        presence_penalty: 0.6,
        frequency_penalty: 0.4,
      }),
    });

    data = await resp.json().catch(() => ({}));
  } catch (e) {
    console.error('[GENERATE_SCRIPT] Fetch failed -> fallback', e);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  // ✅ HARD LOG: did OpenAI actually get called successfully?
  console.log('[GENERATE_SCRIPT] OPENAI_RESPONSE', {
    ok: resp.ok,
    status: resp.status,
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    error: data?.error?.message || null,
  });

  if (!resp.ok) {
    console.error('[GENERATE_SCRIPT] OpenAI error', resp.status, data);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  const raw = data?.choices?.[0]?.message?.content?.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[GENERATE_SCRIPT] JSON parse failed, raw:', raw);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  const narration = parsed?.narration;
  if (!narration || typeof narration !== 'string' || !narration.trim()) {
    console.error('[GENERATE_SCRIPT] Missing narration in JSON:', parsed);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  return { narration: narration.trim(), usedOpenAI: true };
}

/* --------- HTTP handler --------- */
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const {
      storyType = 'Random AI story',
      artStyle = 'Realistic',
      language = 'English',
      customPrompt = '',
      durationRange = '60-90',
    } = body;

    console.log('[GENERATE_SCRIPT] INPUT', {
      storyType,
      artStyle,
      language,
      durationRange,
      hasCustomPrompt: !!customPrompt,
      hasOpenAIKey: !!OPENAI_API_KEY, // ✅ this will tell you immediately in Vercel logs
      model: OPENAI_MODEL,
    });

    const { narration, usedOpenAI } = await callOpenAI({
      storyType,
      artStyle,
      language,
      customPrompt,
      durationRange,
    });

    console.log('[GENERATE_SCRIPT] OUTPUT_PREVIEW', {
      usedOpenAI,
      narrationLen: (narration || '').length,
      preview: (narration || '').slice(0, 140),
    });

    return res.status(200).json({
      storyType,
      artStyle,
      language,
      durationRange,
      usedOpenAI, // ✅ now you’ll know for sure
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
