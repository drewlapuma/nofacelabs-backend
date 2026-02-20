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

function looksLikeRobloxOrGaming(topic) {
  const t = String(topic || "").toLowerCase();
  return /roblox|obby|brookhaven|adopt\s*me|blox|arsenal|mm2|murder\s*mystery|tower\s*of\s*hell|da\s*hood|pet\s*sim|simulator|gamepass|pay\s*to\s*win|lobby|server|chat\s*ban|ban\s*wave/.test(
    t
  );
}

/**
 * Duration rules (tighter):
 * - 30s/45s/90s/120s/180s: keep close to target
 * - 60s: must NEVER be under 60 seconds; can be slightly over
 *
 * We approximate timing via words-per-second.
 * Typical short-form narration ranges ~2.2–2.7 wps depending on energy.
 */
function getWordBounds(targetSeconds) {
  const WPS_TARGET = 2.35; // ~141 wpm
  const WPS_FAST = 2.75;   // fast speaker safety
  const WPS_SLOW = 2.10;   // slower speaker

  // 60s: enforce never below 60s even at fast read
  if (targetSeconds === 60) {
    const minWords = Math.ceil(60 * WPS_FAST); // ~165
    // allow slightly over 60s (up to ~70s at fast, ~90s at slow)
    const maxWords = Math.ceil(70 * WPS_FAST); // ~193
    return { targetSeconds, minWords, maxWords };
  }

  // tighter windows for other buckets
  // (smaller clips should be tighter)
  const tightPct =
    targetSeconds === 30 ? 0.07 : // ±7%
    targetSeconds === 45 ? 0.08 : // ±8%
    targetSeconds === 90 ? 0.08 : // ±8%
    targetSeconds === 120 ? 0.09 : // ±9%
    0.10; // 180: ±10%

  const targetWords = Math.round(targetSeconds * WPS_TARGET);
  const minWords = Math.max(40, Math.floor(targetWords * (1 - tightPct)));
  const maxWords = Math.ceil(targetWords * (1 + tightPct));

  // extra guardrails so tiny prompts don't come out super short
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

function buildSystemPrompt({ isRoblox }) {
  // ✅ generic base prompt (no forced Roblox)
  // ✅ ONLY allow Roblox/game details when topic indicates it
  return `
You write short narration scripts for TikTok/Shorts.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No headings. No word count. No emojis.
- First person ("I").
- Hook in the first 1–2 lines (scroll-stopping).
- Short punchy paragraphs. Easy to read aloud.
- No slurs, hate speech, or explicit sexual content.
- End with EXACTLY ONE question that invites comments (e.g., "Am I tripping?" "What would you do?" "Is this normal?").

Topic fidelity rules:
- Follow the topic exactly as written.
- Do NOT add the word "Roblox" or turn it into a game scenario unless the topic explicitly includes Roblox or obvious gaming keywords.
- If the topic is real-life (e.g., school, bathroom, friends, drama), keep it real-life.
- If the topic is about Roblox/gaming, keep it inside that game-world with believable details (servers, chat, bans, updates, pay-to-win, trading, etc.).

Vibe:
- Sounds like a real creator ranting right after it happened.
- Natural speech, a few quick dialogue snippets are okay (no quotes blocks).
- Keep it believable for the topic category.

${isRoblox ? "Category: GAMING/ROBLOX (okay to reference Roblox-specific concepts)." : "Category: REAL-LIFE/GENERAL (do NOT reference Roblox unless topic says so)."}
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
      "Frame it like I'm ranking the worst parts of the topic, but still a narration (not actual bullets).",
  }[style] || "High energy, punchy rant.";
}

function buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds }) {
  return `
Topic: ${topic}
Style: ${style} (${styleHintsFor(style)})

Length requirement:
- Target duration: ~${targetSeconds}s
- Word count MUST be between ${minWords} and ${maxWords} words.
- Do not intentionally overshoot the max. Stay tight and on-time.

Structure guidance:
- Hook (1–2 lines)
- What happened (specific details)
- My reaction + why it's annoying/unfair
- One twist or escalation
- End with EXACTLY ONE question inviting comments

Important:
- If under ${minWords} words: add natural detail and 1 extra escalation beat.
- If over ${maxWords} words: tighten and remove filler.
- Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, style, secondsBucket }) {
  const { minWords, maxWords, targetSeconds } = getWordBounds(secondsBucket);
  const isRoblox = looksLikeRobloxOrGaming(topic);
  const system = buildSystemPrompt({ isRoblox });

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
        ? `Your last script was ${wc} words (too short). Revise it to be BETWEEN ${minWords} and ${maxWords} words by adding natural detail and exactly one extra escalation beat. Do NOT change the topic category. Output ONLY the revised script.`
        : `Your last script was ${wc} words (too long). Revise it to be BETWEEN ${minWords} and ${maxWords} words by tightening and removing filler. Do NOT change the topic category. Output ONLY the revised script.`;

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
    const style = cleanStyle(body.style || body.tone);
    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 45);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, style, secondsBucket });
    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, {
      ok: true,
      script,
      meta: {
        secondsBucket,
        looksLikeRoblox: looksLikeRobloxOrGaming(topic),
        wordCount: countWords(script),
      },
    });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
