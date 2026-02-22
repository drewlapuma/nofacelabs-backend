// api/roblox-rant-script.js (CommonJS, Node 18+)
// POST { topic, style, seconds, speed }
// => { ok:true, script }

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
  const s = clamp(secondsRaw ?? 60, 20, 180);
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

// ✅ IMPORTANT: word bounds now account for speed
function getWordBounds(targetSeconds, speed) {
  const sp = clamp(speed ?? 1.2, 1.0, 2.0);

  // If scripts are still short, bump these up slightly.
  const BASE_WPS_AT_1X = 2.75;
  const FAST_WPS_AT_1X = 3.10;

  // ✅ 60s rule: NEVER under 60s at chosen speed
  if (targetSeconds === 60) {
    const minWords = Math.ceil(60 * FAST_WPS_AT_1X * sp);
    const maxWords = Math.ceil(78 * FAST_WPS_AT_1X * sp);
    return { targetSeconds, minWords, maxWords, speed: sp };
  }

  const targetWords = Math.round(targetSeconds * BASE_WPS_AT_1X * sp);

  // ✅ Bias longer so 30s doesn't become 20s
  const minWords = Math.max(55, Math.floor(targetWords * 1.08));
  const maxWords = Math.ceil(targetWords * 1.25);

  return { targetSeconds, minWords, maxWords, speed: sp };
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
    const msg = data?.error?.message || data?.message || data?.raw || `OpenAI error (${resp.status})`;
    throw new Error(msg);
  }

  return cleanOutput(data?.choices?.[0]?.message?.content || "");
}

function styleHintsFor(style) {
  return {
    family: "Clean, family-friendly. No profanity. More playful frustration than anger.",
    mild: "Mild annoyance. A little sarcasm, but chill and relatable.",
    hot_take: "High energy, slightly heated, confident opinions. Punchy, funny, a little dramatic.",
    storytime: "Story-first: clear timeline, specific beats, what I did, what they did, what happened next.",
    tier_list: "Frame it like I'm ranking things, but write as narration (no bullets).",
  }[style] || "High energy, punchy rant.";
}

// ✅ SYSTEM PROMPT: do NOT force Roblox into the topic
function buildSystemPrompt() {
  return `
You write short narration scripts for TikTok/Shorts rant videos.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No headings. No word count. No emojis.
- First person ("I").
- Hook in the first 1–2 lines.
- Short punchy paragraphs. Easy to read aloud.
- Stay EXACTLY on the user's topic. Do NOT add "Roblox" unless the topic is actually Roblox-related.
- No slurs, hate speech, or explicit sexual content.
- End with ONE question inviting comments.
`.trim();
}

function buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds, speed }) {
  return `
Topic: ${topic}
Style: ${style} (${styleHintsFor(style)})

Length requirement:
- Target: ${targetSeconds}s at VOICE SPEED ${speed}x
- Word count MUST be between ${minWords} and ${maxWords} words.

Structure guidance:
- Hook (1–2 lines)
- What happened (specific details)
- My reaction + why it's annoying/unfair
- One escalation/twist
- End with ONE question inviting comments

Important:
- Stay on-topic: do not inject unrelated settings (ex: do NOT add "Roblox" unless topic is Roblox).
- If under ${minWords} words, add: (1) 2 extra beats of action, (2) 2 quick dialogue lines, (3) 1 escalation moment.
- If over ${maxWords} words, tighten and remove filler.
- Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, style, secondsBucket, speed }) {
  const { minWords, maxWords, targetSeconds, speed: sp } = getWordBounds(secondsBucket, speed);
  const system = buildSystemPrompt();

  let messages = [
    { role: "system", content: system },
    { role: "user", content: buildUserPrompt({ topic, style, minWords, maxWords, targetSeconds, speed: sp }) },
  ];

  let best = "";
  let bestScore = Infinity;

  // ✅ more attempts + heavy penalty for short
  for (let attempt = 1; attempt <= 6; attempt++) {
    const script = await openaiChat(messages, attempt === 1 ? 0.85 : 0.55);
    const wc = countWords(script);

    if (wc >= minWords && wc <= maxWords) return script;

    const score = wc < minWords ? (minWords - wc) * 4 : (wc - maxWords);
    if (score < bestScore) { bestScore = score; best = script; }

    const fix =
      wc < minWords
        ? `Too short. You wrote ${wc} words. Expand to BETWEEN ${minWords} and ${maxWords} words by adding: (1) 2 extra beats of action, (2) 2 quick dialogue lines, (3) 1 escalation moment, (4) a stronger ending beat. Stay strictly on-topic. Keep ONE ending question. Output ONLY the revised script.`
        : `Too long. You wrote ${wc} words. Tighten to BETWEEN ${minWords} and ${maxWords} words by removing filler and shortening sentences. Stay strictly on-topic. Keep ONE ending question. Output ONLY the revised script.`;

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
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST" });

    const body = req.body || {};
    const topic = String(body.topic || "").trim();
    const style = cleanStyle(body.style || body.tone);
    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 60);

    // ✅ default to 1.2 if client forgets to send it
    const speed = clamp(body.speed ?? body.rrSpeed ?? 1.2, 1.0, 2.0);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, style, secondsBucket, speed });
    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, { ok: true, script });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
