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

async function openaiChat(messages) {
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
      temperature: 0.85,
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
  return String(out).trim();
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
    const seconds = clamp(body.seconds ?? 45, 20, 120);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    // Rough words target (spoken ~2.2 words/sec)
    const targetWords = Math.round(seconds * 2.2);

    const styleHints = {
      funny:
        "Funny but believable. A little sarcastic. Keep it punchy and scroll-stopping.",
      dramatic:
        "Dramatic, tense, cliffhanger energy. Keep it believable, not corny.",
      serious:
        "Serious, reflective, realistic. No jokes unless they fit naturally.",
    }[tone];

    const system = `
You write short narration scripts for TikTok/Shorts "Reddit story" videos.
Constraints:
- Keep it realistic and engaging.
- Write as a FIRST PERSON storyteller ("I") with a hook in the first 1–2 lines.
- End with a question that invites comments (AITA / what would you do / etc.).
Output ONLY the script, no title, no bullet points.
`.trim();

    const user = `
Topic: ${topic}
Tone: ${tone} (${styleHints})
Length: about ${seconds}s (~${targetWords} words)

Make it sound like a real Reddit post narration:
- quick hook
- short paragraphs
- clear timeline
- 1–2 twists
- final question
`.trim();

    const script = await openaiChat([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    return json(res, 200, { ok: true, script });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
