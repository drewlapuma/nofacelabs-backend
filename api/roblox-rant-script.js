// api/roblox-rant-script.js (CommonJS, Node 18+)
// POST { topic, style, seconds }
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

function countWords(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

function normalizeSecondsBucket(secondsRaw) {
  const s = clamp(secondsRaw ?? 45, 20, 180);

  // Your UI options: 30,45,60,90,120,180 (based on your surprise array)
  if (s >= 150) return 180;
  if (s >= 105) return 120;
  if (s >= 75) return 90;
  if (s >= 52) return 60;
  if (s >= 38) return 45;
  return 30;
}

/**
 * Duration control rules:
 * - 60s: can NEVER be less than 60s (min words), can be a little more
 * - Others: "around there" window
 */
function getWordBounds(targetSeconds) {
  const WPS_TYP = 2.35; // rant cadence is often slightly faster than Reddit narration

  if (targetSeconds === 60) {
    const MIN_WPS_FAST = 2.7;        // fast speaker safety
    const minWords = Math.ceil(60 * MIN_WPS_FAST); // ~162
    const maxWords = Math.ceil(78 * MIN_WPS_FAST); // allow a bit over (~78s fast)
    return { targetSeconds, minWords, maxWords };
  }

  const targetWords = Math.round(targetSeconds * WPS_TYP);
  const minWords = Math.max(55, Math.floor(targetWords * 0.85));
  const maxWords = Math.ceil(targetWords * 1.15);

  return { targetSeconds, minWords, maxWords };
}

function cleanStyle(style) {
  const s = String(style || "").toLowerCase().trim();
  const allowed = ["family", "mild", "hot_take", "storytime", "tier_list"];
  return allowed.includes(s) ? s : "hot_take";
}

function cleanOutput(s) {
  let out = String(s || "").trim();
  out = out.replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").trim();
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
You write short narration scripts for TikTok/Shorts "Roblox rant" videos.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No headings. No word count. No emojis.
- First person ("I").
- Hook in the first 1–2 lines (scroll-stopping).
- Sound like a real creator ranting after something happened in-game.
- Short punchy paragraphs. Easy to read aloud.
- Keep it believable: Roblox, lobbies, trading, obbies, pay-to-win, toxic chat, scammers, bad updates, unfair bans, etc.
- No slurs, hate speech, or explicit content.
- End with ONE question that invites comments (e.g., "Am I tripping?" "What would you do?" "Is this normal?").
`.trim();
}

function styleHintsFor(style) {
  return {
    family:
      "Clean, family-friendly. No profanity. More playful frustration than anger.",
    mild:
      "Mild annoyance. A little sarcasm, but chill and relatable.",
    hot_take:
      "High energy, slightly heated, confident opinions. Punchy, funny, a little dramatic.",
    storytime:
      "Story-first: clear timeline, specific beats, what I did, what they did, what happened next.",
    tier_list:
      "Frame it like I'm ranking the worst Roblox behaviors/updates/mechanics, but still a rant narration (not actual bullets).",
  }[style] || "High energy, punchy rant.";
}

function buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds }) {
  return `
Topic: ${topic}
Style: ${style} (${styleHintsFor(style)})

Length requirement:
- Target: ${targetSeconds}s
- Word count MUST be between ${minWords} and ${maxWords} words.

Structure guidance:
- Hook (1–2 lines)
- What happened (specific details)
- My reaction + why it's annoying/unfair
- One twist or escalation (someone says/does something, or update makes it worse)
- End with ONE question inviting comments

Important:
- If under ${minWords} words, add natural detail (actions, quick dialogue snippets, reactions).
- If over ${maxWords} words, tighten and remove filler.
- Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, style, secondsBucket }) {
  const { minWords, maxWords, targetSeconds } = getWordBounds(secondsBucket);
  const system = buildSystemPrompt();

  let messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds }),
    },
  ];

  let best = "";
  let bestScore = Infinity;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const script = await openaiChat(messages, attempt === 1 ? 0.85 : 0.6);
    const wc = countWords(script);

    if (wc >= minWords && wc <= maxWords) return script;

    const score = wc < minWords ? (minWords - wc) * 2 : (wc - maxWords);
    if (score < bestScore) {
      bestScore = score;
      best = script;
    }

    const fix =
      wc < minWords
        ? `Your last script was ${wc} words (too short). Revise it to be BETWEEN ${minWords} and ${maxWords} words by adding natural detail, quick dialogue, and 1 extra escalation beat. Keep the same vibe and ending question. Output ONLY the revised script.`
        : `Your last script was ${wc} words (too long). Revise it to be BETWEEN ${minWords} and ${maxWords} words by tightening and removing filler. Keep the same vibe and ending question. Output ONLY the revised script.`;

    messages = [
      { role: "system", content: system },
      { role: "assistant", content: script },
      { role: "user", content: fix },
    ];
  }

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
    const style = cleanStyle(body.style || body.tone); // allow tone alias
    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 45);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, style, secondsBucket });
    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, { ok: true, script });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
