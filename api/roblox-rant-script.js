// api/roblox-rant-script.js (CommonJS, Node 18+)
// POST { topic, style, seconds, speed? }  (also accepts rrSpeed)
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-nf-member-id, x-nf-member-email"
  );
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

  // UI options: 30,45,60,90,120,180
  if (s >= 150) return 180;
  if (s >= 105) return 120;
  if (s >= 75) return 90;
  if (s >= 52) return 60;
  if (s >= 38) return 45;
  return 30;
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

function readSpeed(body) {
  // ✅ default = 1.2x as requested
  const raw = body?.speed ?? body?.rrSpeed ?? body?.voiceSpeed ?? 1.2;
  return clamp(raw, 1.0, 2.0);
}

/**
 * WORD BOUNDS THAT TARGET DURATION AT THE GIVEN SPEED
 *
 * If speed > 1, audio becomes shorter.
 * So we must generate MORE words to keep the same seconds.
 *
 * Effective words-per-second increases ~proportionally with speed,
 * so targetWords = seconds * (baseWPS * speed)
 */
function getWordBounds(targetSeconds, speed) {
  // base at 1.0x (tweakable)
  const BASE_WPS = 2.35;

  const sp = clamp(speed, 1.0, 2.0);

  if (targetSeconds === 60) {
    // ✅ must NEVER be less than 60s (at current speed)
    // guard for "fast speaker" at this speed
    const FAST_WPS_AT_1X = 2.7; // your prior fast speaker safety
    const minWords = Math.ceil(60 * FAST_WPS_AT_1X * sp);

    // allow a bit more than a minute
    const maxWords = Math.ceil(75 * FAST_WPS_AT_1X * sp);

    return { targetSeconds, minWords, maxWords };
  }

  // 30 / 45 / 90 / 120 / 180 should be "around there"
  const targetWords = Math.round(targetSeconds * BASE_WPS * sp);

  // tighter window than before (more accurate timing)
  const minWords = Math.max(45, Math.floor(targetWords * 0.92));
  const maxWords = Math.ceil(targetWords * 1.08);

  return { targetSeconds, minWords, maxWords };
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
You write short TikTok/Shorts narration scripts based on the user's topic prompt.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No headings. No word count. No emojis.
- First person ("I").
- Hook in the first 1–2 lines (scroll-stopping).
- Short punchy paragraphs. Easy to read aloud.
- Follow the TOPIC literally. Do NOT add "Roblox" unless the topic is actually about Roblox.
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
      "Frame it like I'm ranking the worst behaviors/things, but as a rant narration (no bullets).",
  }[style] || "High energy, punchy rant.";
}

function buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds, speed }) {
  return `
Topic: ${topic}
Style: ${style} (${styleHintsFor(style)})

Length requirement (IMPORTANT):
- Target duration: ${targetSeconds}s
- Assume narration speed is ${Number(speed).toFixed(1)}x.
- Word count MUST be between ${minWords} and ${maxWords} words.

Structure guidance:
- Hook (1–2 lines)
- What happened (specific details)
- My reaction + why it's annoying/unfair
- One twist or escalation
- End with ONE question inviting comments

Important:
- Follow the topic exactly. If the topic is NOT Roblox, do NOT mention Roblox.
- If under ${minWords} words, add natural detail and 1 extra beat.
- If over ${maxWords} words, tighten and remove filler.
- Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, style, secondsBucket, speed }) {
  const { minWords, maxWords, targetSeconds } = getWordBounds(secondsBucket, speed);
  const system = buildSystemPrompt();

  let messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds, speed }),
    },
  ];

  let best = "";
  let bestScore = Infinity;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const script = await openaiChat(messages, attempt === 1 ? 0.85 : 0.55);
    const wc = countWords(script);

    if (wc >= minWords && wc <= maxWords) return script;

    const score = wc < minWords ? (minWords - wc) * 2 : (wc - maxWords);
    if (score < bestScore) {
      bestScore = score;
      best = script;
    }

    const fix =
      wc < minWords
        ? `Your last script was ${wc} words (too short). Expand it to be BETWEEN ${minWords} and ${maxWords} words while staying strictly on-topic. Add 1 extra escalation beat + natural detail. Keep ONE ending question. Output ONLY the revised script.`
        : `Your last script was ${wc} words (too long). Tighten it to be BETWEEN ${minWords} and ${maxWords} words while staying strictly on-topic. Keep ONE ending question. Output ONLY the revised script.`;

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
    const topic = String(body.topic || body.prompt || "").trim();
    const style = cleanStyle(body.style || body.tone);
    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 60);

    // ✅ speed-aware length targeting (default 1.2)
    const speed = readSpeed(body);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, style, secondsBucket, speed });
    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, { ok: true, script, meta: { secondsBucket, speed } });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
