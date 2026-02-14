// api/reddit-script.js (CommonJS, Node 18+)
// POST { topic, tone, seconds }
// => { ok:true, script }
//
// Env:
// - OPENAI_API_KEY
// - OPENAI_MODEL (optional) default: gpt-4.1-mini
// - ALLOW_ORIGIN or ALLOW_ORIGINS (optional)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function clamp(n, a, b) {
  n = Number(n);
  if (!Number.isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function cleanTone(t) {
  const s = String(t || "").toLowerCase().trim();
  if (["funny", "dramatic", "serious"].includes(s)) return s;
  return "funny";
}

function countWords(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function normalizeSecondsBucket(secondsRaw) {
  const s = clamp(secondsRaw ?? 45, 20, 120);

  // Your UI options: 45s, 60s, 90s (1m30)
  // Bucket anything near them to the intended target.
  if (s >= 80) return 90;
  if (s >= 55) return 60;
  return 45;
}

/**
 * Duration control rules you asked for:
 * - 45s: can be anywhere around there (range)
 * - 60s: can NEVER be less than 60s (min words), can be a little more
 * - 90s: can be anywhere around there (range)
 *
 * We enforce this by controlling WORD COUNT with a retry loop.
 */
function getWordBounds(targetSeconds) {
  // Typical narration: ~2.2 words/sec, but people can speak faster.
  // For the 60s option we must avoid being *under* 60s, so we set a MIN words
  // based on a faster speaking rate to guarantee it won't be shorter.
  const WPS_TYP = 2.2;

  if (targetSeconds === 60) {
    // Guarantee >= 60s even if someone speaks fast (~2.6 wps)
    const MIN_WPS_FAST = 2.6;
    const minWords = Math.ceil(60 * MIN_WPS_FAST); // ~156
    const maxWords = Math.ceil(75 * MIN_WPS_FAST); // allow "a little more" (up to ~75s fast)
    return { targetSeconds, minWords, maxWords };
  }

  // 45 and 90 can be "around there"
  const targetWords = Math.round(targetSeconds * WPS_TYP);

  // +/- ~15% window (tweak if you want tighter/looser)
  const minWords = Math.max(60, Math.floor(targetWords * 0.85));
  const maxWords = Math.ceil(targetWords * 1.15);

  return { targetSeconds, minWords, maxWords };
}

function cleanOutput(s) {
  let out = String(s || "").trim();

  // remove code fences if the model ever adds them
  out = out.replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").trim();

  // remove leading "Script:" etc
  out = out.replace(/^(script|narration)\s*:\s*/i, "").trim();

  return out;
}

async function openaiChat(messages, temperature = 0.75) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      temperature,
    }),
  });

  const text = await resp.text().catch(() => "");
  let data = {};
  try {
    data = JSON.parse(text || "{}");
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      data?.raw ||
      `OpenAI error (${resp.status})`;
    throw new Error(msg);
  }

  const out = data?.choices?.[0]?.message?.content || "";
  return cleanOutput(out);
}

function buildSystemPrompt() {
  return `
You write short narration scripts for TikTok/Shorts "Reddit story" videos.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No word count. No headings. No asteriks.
- First person storyteller ("I").
- Hook in the first 1–2 lines.
- Short paragraphs, easy to read aloud.
- Clear timeline, 1–2 twists.
- End with ONE question inviting comments (AITA / what would you do / etc.).
`.trim();
}

function buildUserPrompt({ topic, tone, styleHints, minWords, maxWords, targetSeconds }) {
  return `
Topic: ${topic}
Tone: ${tone} (${styleHints})

Length requirement:
- Target: ${targetSeconds}s
- Word count MUST be between ${minWords} and ${maxWords} words.

Important:
- If you are under ${minWords} words, add detail (actions, dialogue snippets, reactions).
- If you are over ${maxWords} words, tighten and remove filler.
- Keep it sounding like a real Reddit narration, not an essay.
`.trim();
}

async function generateWithWordBounds({ topic, tone, secondsBucket }) {
  const { minWords, maxWords, targetSeconds } = getWordBounds(secondsBucket);

  const styleHints = {
    funny:
      "Funny but believable. A little sarcastic. Keep it punchy and scroll-stopping.",
    dramatic:
      "Dramatic, tense, cliffhanger energy. Keep it believable, not corny.",
    serious:
      "Serious, reflective, realistic. No jokes unless they fit naturally.",
  }[tone];

  const system = buildSystemPrompt();

  // We use a retry loop to force the word-count window.
  // Attempt 1: generate
  // Attempt 2-3: revise to fit bounds while keeping same story
  let messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: buildUserPrompt({ topic, tone, styleHints, minWords, maxWords, targetSeconds }),
    },
  ];

  let best = "";
  let bestScore = Infinity;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const script = await openaiChat(messages, attempt === 1 ? 0.8 : 0.6);
    const wc = countWords(script);

    // perfect
    if (wc >= minWords && wc <= maxWords) return script;

    // track closest
    const score =
      wc < minWords ? (minWords - wc) * 2 : (wc - maxWords); // penalize being short more
    if (score < bestScore) {
      bestScore = score;
      best = script;
    }

    // Revision instruction
    const fix =
      wc < minWords
        ? `Your last script was ${wc} words (too short). Revise it to be BETWEEN ${minWords} and ${maxWords} words by adding natural detail, reactions, and 1–2 extra beats. Keep the same story and ending question. Output ONLY the revised script.`
        : `Your last script was ${wc} words (too long). Revise it to be BETWEEN ${minWords} and ${maxWords} words by tightening and removing filler. Keep the same story and ending question. Output ONLY the revised script.`;

    messages = [
      { role: "system", content: system },
      { role: "assistant", content: script },
      { role: "user", content: fix },
    ];
  }

  // fallback (closest attempt)
  return best || "";
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();

  try {
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Use POST" });
    }

    const body = req.body || {};
    const topic = String(body.topic || "").trim();
    const tone = cleanTone(body.tone);
    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 45);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, tone, secondsBucket });

    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, { ok: true, script });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
