// api/roblox-rant-script.js (CommonJS, Node 18+)
// POST { topic, theme, tone, seconds, speed }
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

// ✅ safer for serverless: handle both parsed and raw stream bodies
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data.trim()) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
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

/**
 * Supports your UI buckets (30/45/60/90).
 * Also safely handles older clients that still send 120/180.
 */
function normalizeSecondsBucket(secondsRaw) {
  const s = clamp(secondsRaw ?? 60, 20, 180);
  if (s >= 150) return 180;
  if (s >= 105) return 120;
  if (s >= 75) return 90;
  if (s >= 52) return 60;
  if (s >= 38) return 45;
  return 30;
}

/* -------------------- THEME + TONE -------------------- */

function cleanTheme(theme) {
  const s = String(theme || "").toLowerCase().trim();
  const allowed = new Set([
    "any",
    "gaming",
    "roblox",
    "tech",
    "ai",
    "science",
    "psychology",
    "mystery",
    "thriller",
    "space",
    "myth",
    "history",
    "geography",
    "nature",
    "animals",
    "sports",
    "school",
    "relationships",
    "money",
    "life",
    "random",
  ]);
  return allowed.has(s) ? s : "any";
}

function cleanTone(tone) {
  const s = String(tone || "").toLowerCase().trim();
  const allowed = new Set([
    "cinematic",
    "suspense",
    "educational",
    "dark",
    "inspiring",
    "humorous",
    "dramatic",
    "casual",
    "roast",
    "hot_take",
    "storytime",
    "wholesome",
    "sarcastic",
    "serious",
    "motivational",
    "chill",
  ]);
  return allowed.has(s) ? s : "hot_take";
}

function cleanOutput(s) {
  let out = String(s || "").trim();
  out = out.replace(/^```[\s\S]*?\n/, "").replace(/```$/g, "").trim();
  out = out.replace(/^(script|narration)\s*:\s*/i, "").trim();
  return out;
}

// ✅ IMPORTANT: word bounds account for speed
function getWordBounds(targetSeconds, speed) {
  const sp = clamp(speed ?? 1.2, 1.0, 2.0);

  const BASE_WPS_AT_1X = 2.75;
  const FAST_WPS_AT_1X = 3.1;

  // ✅ 60s rule: bias longer (avoid under-length)
  if (targetSeconds === 60) {
    const minWords = Math.ceil(60 * FAST_WPS_AT_1X * sp);
    const maxWords = Math.ceil(78 * FAST_WPS_AT_1X * sp);
    return { targetSeconds, minWords, maxWords, speed: sp };
  }

  const targetWords = Math.round(targetSeconds * BASE_WPS_AT_1X * sp);
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

function themeHintsFor(theme) {
  return {
    any: "General audience. Use the topic as-is.",
    gaming: "Use gamer language lightly (ranked, meta, patch notes, grind), but stay brand-safe.",
    roblox: "Only use Roblox-specific references if the topic clearly fits Roblox or the user asked for it.",
    tech: "Modern app/phone/internet references, usability pain points, updates, bugs.",
    ai: "AI tools, prompts, automation, 'why is it doing THAT' moments; keep it accessible.",
    science: "Simple science framing, cause/effect, 'here’s the weird part' energy.",
    psychology: "Relatable behavior patterns, habits, social dynamics; no diagnosing.",
    mystery: "Tease clues and a reveal; keep it realistic and not scary-gory.",
    thriller: "Tension + escalation beats; still brand-safe (no violence details).",
    space: "Space/astronomy metaphors, wonder, scale; keep it fun.",
    myth: "Myth/legend framing as metaphors; not preachy.",
    history: "Light historical parallels; no heavy dates needed.",
    geography: "Places, travel vibes, regional quirks; keep it broad.",
    nature: "Outdoor/wildlife metaphors and sensory details; still a rant.",
    animals: "Pet/animal comparisons, cute/chaotic energy.",
    sports: "Sports metaphors (coach, playbook, clutch), but keep it accessible.",
    school: "Classroom/homework/teachers/social dynamics; keep it non-hateful.",
    relationships: "Friendships/dating/social etiquette; respectful, not explicit.",
    money: "Prices, subscriptions, value, budgeting pain; no financial advice.",
    life: "Everyday annoyances; relatable beats.",
    random: "Wildcard: still coherent, but with surprise comparisons.",
  }[theme] || "General audience. Use the topic as-is.";
}

function toneHintsFor(tone) {
  return {
    cinematic: "Cinematic pacing. Big vivid lines, strong build, dramatic emphasis.",
    suspense: "Hold back the key detail, tease, escalate, reveal near the end.",
    educational: "Explain the 'why' clearly, teach one useful takeaway without lecturing.",
    dark: "Moody and intense, but keep it brand-safe and non-graphic.",
    inspiring: "End on an uplifting reframing and empowerment vibe.",
    humorous: "Jokes, exaggeration, playful analogies; still coherent.",
    dramatic: "Big emotions, quick punches, emphasis, but not hateful.",
    casual: "Conversational, chill, like talking to a friend.",
    roast: "Roasty and spicy but not mean-spirited; no protected-trait insults.",
    hot_take: "Confident opinion. Punchy, assertive, 'hear me out' energy.",
    storytime: "Clear timeline story beats: what happened, then what, then the twist.",
    wholesome: "Warm and kind, light frustration, safe for all ages.",
    sarcastic: "Dry humor, ironic contrast, witty side comments.",
    serious: "Direct, grounded, no jokes, clear logic.",
    motivational: "Coach-like energy, action-oriented, 'here’s what I’m doing now'.",
    chill: "Low-stakes, laid-back, minimal intensity.",
  }[tone] || "Punchy, confident, funny, a little dramatic.";
}

function buildSystemPrompt() {
  return `
You write short narration scripts for TikTok/Shorts rant videos.

Hard constraints:
- Output ONLY the script. No title. No bullet points. No headings. No word count. No emojis.
- First person ("I").
- Hook in the first 1–2 lines.
- Short punchy paragraphs. Easy to read aloud.
- Stay EXACTLY on the user's topic. Do NOT inject unrelated settings/franchises.
- Theme is a flavor layer (metaphors/examples) ONLY if it naturally fits the topic.
- No slurs, hate speech, or explicit sexual content.
- No graphic violence or self-harm content.
- End with ONE question inviting comments.
`.trim();
}

function buildUserPrompt({ topic, theme, tone, minWords, maxWords, targetSeconds, speed }) {
  return `
Topic: ${topic}

Theme: ${theme} (${themeHintsFor(theme)})
Tone: ${tone} (${toneHintsFor(tone)})

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
- Stay on-topic. Do not add random brands/franchises unless topic calls for it.
- If under ${minWords} words, add: (1) 2 extra beats of action, (2) 2 quick dialogue lines, (3) 1 escalation moment.
- If over ${maxWords} words, tighten and remove filler.
- Output ONLY the script.
`.trim();
}

async function generateWithWordBounds({ topic, theme, tone, secondsBucket, speed }) {
  const { minWords, maxWords, targetSeconds, speed: sp } = getWordBounds(secondsBucket, speed);
  const system = buildSystemPrompt();

  let messages = [
    { role: "system", content: system },
    { role: "user", content: buildUserPrompt({ topic, theme, tone, minWords, maxWords, targetSeconds, speed: sp }) },
  ];

  let best = "";
  let bestScore = Infinity;

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

    const body = await readBody(req);

    const topic = String(body.topic || "").trim();
    const theme = cleanTheme(body.theme);

    // ✅ accept either tone OR old style field
    const tone = cleanTone(body.tone || body.style);

    const secondsBucket = normalizeSecondsBucket(body.seconds ?? 60);
    const speed = clamp(body.speed ?? body.rrSpeed ?? 1.2, 1.0, 2.0);

    if (!topic) return json(res, 400, { ok: false, error: "Missing topic" });

    const script = await generateWithWordBounds({ topic, theme, tone, secondsBucket, speed });
    if (!script) return json(res, 500, { ok: false, error: "Failed to generate script" });

    return json(res, 200, { ok: true, script, theme, tone, seconds: secondsBucket });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
