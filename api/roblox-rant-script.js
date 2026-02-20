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
 * ✅ Updated duration math:
 * Your generated audio is reading faster than 2.35 wps.
 * We target ~3.0 words/sec so 30s/45s/60s stop coming out short.
 */
function getWordBounds(targetSeconds) {
  const WPS_TARGET = 3.0; // ~180 wpm (matches your observed ElevenLabs pace)
  const WPS_FAST_SAFETY = 3.3; // very fast speaker safety (for "never under 60s")

  // Tight windows by clip length
  const pct =
    targetSeconds === 30 ? 0.06 : // ±6%
    targetSeconds === 45 ? 0.07 : // ±7%
    targetSeconds === 90 ? 0.08 : // ±8%
    targetSeconds === 120 ? 0.09 : // ±9%
    0.10; // 180: ±10%

  // 60s: never under 60s, even if spoken fast
  if (targetSeconds === 60) {
    const targetWords = Math.round(60 * WPS_TARGET); // 180
    const minWords = Math.ceil(60 * WPS_FAST_SAFETY); // 198 (enforces >= ~60s at fast pace)
    const maxWords = Math.ceil(targetWords * 1.12);   // allow a bit over (up to ~202)
    return {
      targetSeconds,
      targetWords,
      minWords,
      maxWords: Math.max(maxWords, minWords + 6),
    };
  }

  const targetWords = Math.round(targetSeconds * WPS_TARGET);
  const minWords = Math.max(55, Math.floor(targetWords * (1 - pct)));
  const maxWords = Math.ceil(targetWords * (1 + pct));

  return { targetSeconds, targetWords, minWords, maxWords };
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
  return `
You write short narration scripts for TikTok/Shorts.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No headings. No word count. No emojis.
- First person ("I").
- Hook in the first 1–2 lines (scroll-stopping).
- Short punchy paragraphs. Easy to read aloud.
- No slurs, hate speech, or explicit sexual content.
- End with EXACTLY ONE question that invites comments.

Topic fidelity rules:
- Follow the topic exactly as written.
- Do NOT add the word "Roblox" or turn it into a game scenario unless the topic explicitly includes Roblox or obvious gaming keywords.
- If the topic is real-life, keep it real-life.
- If the topic is gaming/Roblox, keep it in that world with believable details.

Vibe:
- Sounds like a real creator ranting right after it happened.
- Natural speech; quick dialogue snippets are okay.
${isRoblox ? "Category: GAMING/ROBLOX (Roblox terms allowed)." : "Category: REAL-LIFE/GENERAL (Roblox terms NOT allowed unless topic says so)."}
`.trim();
}

function styleHintsFor(style) {
  return {
    family: "Clean, family-friendly. No profanity. Playful frustration.",
    mild: "Mild annoyance, relatable, light sarcasm.",
    hot_take: "High energy, confident opinions, funny and punchy.",
    storytime: "Clear timeline beats: what happened, then what happened next.",
    tier_list: "Sounds like ranking the worst parts, but still a narration (no bullets).",
  }[style] || "High energy, punchy rant.";
}

function buildUserPrompt({ topic, style, minWords, maxWords, targetWords, targetSeconds }) {
  return `
Topic: ${topic}
Style: ${style} (${styleHintsFor(style)})

LENGTH (VERY IMPORTANT):
- Target duration: ~${targetSeconds}s
- Target word count: ~${targetWords} words
- Word count MUST be BETWEEN ${minWords} and ${maxWords} words.

Structure:
- Hook (1–2 lines)
- What happened (specific details)
- My reaction + why it's annoying/unfair
- One twist/escalation
- End with EXACTLY ONE question inviting comments

Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, style, secondsBucket }) {
  const { minWords, maxWords, targetWords, targetSeconds } = getWordBounds(secondsBucket);
  const isRoblox = looksLikeRobloxOrGaming(topic);
  const system = buildSystemPrompt({ isRoblox });

  let messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: buildUserPrompt({ topic, style, minWords, maxWords, targetWords, targetSeconds }),
    },
  ];

  let best = "";
  let bestScore = Infinity;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const script = await openaiChat(messages, attempt === 1 ? 0.85 : 0.6);
    const wc = countWords(script);

    if (wc >= minWords && wc <= maxWords) return script;

    const score = wc < minWords ? (minWords - wc) * 2 : (wc - maxWords);
    if (score < bestScore) {
      bestScore = score;
      best = script;
    }

    // Stronger rewrite instruction: models comply better with a specific target word count
    const direction =
      wc < minWords
        ? `too short`
        : `too long`;

    const fix =
      `Your last script was ${wc} words (${direction}). ` +
      `Rewrite it to be BETWEEN ${minWords} and ${maxWords} words, aiming for about ${targetWords} words. ` +
      `Keep the SAME topic category (do not add Roblox unless topic explicitly includes it). ` +
      `Keep the hook strong, add/remove natural detail, keep EXACTLY ONE ending question. ` +
      `Output ONLY the revised script.`;

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

    const wc = countWords(script);
    const b = getWordBounds(secondsBucket);

    return json(res, 200, {
      ok: true,
      script,
      meta: {
        secondsBucket,
        looksLikeRoblox: looksLikeRobloxOrGaming(topic),
        wordCount: wc,
        targetWords: b.targetWords,
        minWords: b.minWords,
        maxWords: b.maxWords,
      },
    });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
