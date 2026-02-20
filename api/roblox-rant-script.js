// api/roblox-rant-script.js (CommonJS, Node 18+)
// POST { topic, style, seconds, rrSpeed? | voiceSpeed? }
// => { ok:true, script }
//
// ✅ Changes:
// 1) NO forced "Roblox" — follows the prompt topic as-is.
// 2) Duration is tighter + more accurate per bucket.
// 3) Speed-aware word targeting (Option A): if rrSpeed/voiceSpeed is higher,
//    we generate proportionally more words so the FINAL spoken time stays near target.
// 4) 60s bucket rule: NEVER under 60s (script will be 60s or slightly longer even after speed-up).

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
  // ✅ allow Memberstack/NF headers so preflight doesn't fail
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

// ✅ tighter windows by bucket (more accurate)
function bucketWindowPct(targetSeconds) {
  // smaller buckets need tighter bounds
  if (targetSeconds === 30) return 0.05;  // ±5%
  if (targetSeconds === 45) return 0.06;  // ±6%
  if (targetSeconds === 60) return 0.06;  // (but we override w/ "never under")
  if (targetSeconds === 90) return 0.07;
  if (targetSeconds === 120) return 0.08;
  return 0.10; // 180
}

/**
 * ✅ Option A: speed-aware word bounds.
 * If speed increases, we generate proportionally more words so final duration stays ~targetSeconds.
 *
 * Base cadence at speed=1.0:
 * - This is a "creator rant" pace (faster than calm narration)
 * - Tune if needed: if your 30s scripts still land short, slightly raise WPS_BASE (e.g., 3.1–3.3)
 */
function getWordBounds(targetSeconds, voiceSpeed = 1) {
  const sp = clamp(voiceSpeed, 1.0, 2.0);

  // baseline spoken pace at speed 1.0 (words per second)
  const WPS_BASE = 3.0;

  // ✅ target words scaled by speed so final duration stays near target
  const targetWords = Math.round(targetSeconds * WPS_BASE * sp);

  // tighter windows
  const pct = bucketWindowPct(targetSeconds);
  let minWords = Math.floor(targetWords * (1 - pct));
  let maxWords = Math.ceil(targetWords * (1 + pct));

  // keep some sanity minimum
  minWords = Math.max(40, minWords);
  maxWords = Math.max(minWords + 8, maxWords);

  // ✅ 60s rule: NEVER under 60s (even after speed-up)
  // We enforce a minimum word count that should land >= 60s.
  // Using a "fast" safety WPS so we don't accidentally go under.
  if (targetSeconds === 60) {
    const WPS_FAST_SAFETY = 3.35; // assume fast delivery at speed=1.0
    const hardMin = Math.ceil(60 * WPS_FAST_SAFETY * sp);
    minWords = Math.max(minWords, hardMin);

    // allow a little over, but keep it controlled
    const overMax = Math.ceil(targetWords * 1.12);
    maxWords = Math.max(overMax, minWords + 10);
  }

  return { targetSeconds, targetWords, minWords, maxWords, voiceSpeed: sp };
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
  try { data = JSON.parse(text || "{}"); } catch { data = { raw: text }; }

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
  // ✅ Generic creator-rant prompt that follows the user's topic.
  // Roblox is only mentioned as an EXAMPLE setting — not mandatory.
  return `
You write short narration scripts for TikTok/Shorts "creator rant" videos.

Core rules:
- Follow the user's TOPIC exactly. Do NOT add "Roblox" or any other setting unless the topic itself implies it.
- Output ONLY the script. No title. No bullet points. No headings. No emojis. No word count.
- First person ("I").
- Hook in the first 1–2 lines (scroll-stopping).
- Short, punchy paragraphs. Easy to read aloud.
- Sound like a real person ranting right after something happened.
- Keep it believable and specific to the topic (examples: school drama, sports, gaming, jobs, relationships, weird customers, bad updates, etc.).
- No slurs, hate speech, or explicit sexual content.
- End with ONE question that invites comments.
`.trim();
}

function styleHintsFor(style) {
  return {
    family: "Clean, family-friendly. No profanity. More playful frustration than anger.",
    mild: "Mild annoyance. A little sarcasm, but chill and relatable.",
    hot_take: "High energy, slightly heated, confident opinions. Punchy, funny, a little dramatic.",
    storytime: "Story-first: clear timeline, specific beats, what I did, what they did, what happened next.",
    tier_list:
      "Frame it like I'm ranking the worst parts of the topic, but still as a narration (no bullets, no numbered list).",
  }[style] || "High energy, punchy rant.";
}

function buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds }) {
  return `
TOPIC (follow exactly): ${topic}
STYLE: ${style} (${styleHintsFor(style)})

LENGTH:
- Target: ~${targetSeconds} seconds when read aloud at the user's chosen voice speed
- Word count MUST be between ${minWords} and ${maxWords} words.

STRUCTURE:
- Hook (1–2 lines)
- What happened (specific details)
- My reaction + why it's annoying/unfair
- One twist/escalation
- End with ONE question inviting comments

IMPORTANT:
- Do NOT add "Roblox" unless the topic explicitly involves Roblox.
- If too short, add natural detail (actions, quick dialogue, reactions, setting details).
- If too long, tighten and remove filler.
- Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, style, secondsBucket, voiceSpeed }) {
  const { minWords, maxWords, targetSeconds } = getWordBounds(secondsBucket, voiceSpeed);
  const system = buildSystemPrompt();

  let messages = [
    { role: "system", content: system },
    { role: "user", content: buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds }) },
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
        ? `Your last script was ${wc} words (too short). Revise it to be BETWEEN ${minWords} and ${maxWords} words by adding natural detail + 1 escalation beat, staying strictly on-topic. Output ONLY the revised script.`
        : `Your last script was ${wc} words (too long). Revise it to be BETWEEN ${minWords} and ${maxWords} words by tightening and removing filler, staying strictly on-topic. Output ONLY the revised script.`;

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
    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 45);

    // ✅ speed-aware (Option A) — accept either name from your frontend
    const voiceSpeed = clamp(body.voiceSpeed ?? body.rrSpeed ?? body.speed ?? 1, 1, 2);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, style, secondsBucket, voiceSpeed });
    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, {
      ok: true,
      script,
      meta: {
        secondsBucket,
        voiceSpeed,
      },
    });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
