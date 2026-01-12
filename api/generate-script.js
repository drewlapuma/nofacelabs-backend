// api/generate-script.js  (CommonJS, Node 18+)

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* --------- Story type classifier --------- */
function classifyStoryType(storyTypeRaw) {
  const s = String(storyTypeRaw || "").toLowerCase();

  if (s.includes("scary")) return "scary";
  if (s.includes("urban")) return "urbanLegend";
  if (s.includes("bedtime")) return "bedtime";
  if (s.includes("what if") || s.includes("whatif")) return "whatIf";
  if (s.includes("history")) return "history";
  if (s.includes("fun fact") || s.includes("funfacts")) return "funFacts";
  if (s.includes("philosophy")) return "philosophy";
  if (s.includes("motivational")) return "motivational";
  if (s.includes("custom")) return "customPrompt";
  if (s.includes("random")) return "random";

  return "generic";
}

/* --------- Style / narration hints for the model --------- */
function buildStyleHints(mode) {
  switch (mode) {
    case "scary":
      return [
        "Write a creepy suspense story with a twist or reveal.",
        "Tell the story as a sequence of very visual moments the viewer could actually see.",
        'Avoid vague lines like "it felt scary" unless attached to a clear visual detail.',
        "Do NOT default to the same tropes (alley, streetlamp, abandoned house, 3:00 AM, static on TV) unless explicitly requested.",
      ].join(" ");

    case "urbanLegend":
      return [
        "Write it like an urban legend people swear is true.",
        "Sound conversational and matter-of-fact, like someone recounting a real incident.",
        "End with mystery or ambiguity (not a neat explanation).",
        "Keep it very visual: describe places, signs, objects, and small details people remember.",
      ].join(" ");

    case "bedtime":
      return [
        "Write a calm, cozy, gentle bedtime story with a soothing ending.",
        "No horror and no intense danger. Any tension should be mild and quickly resolved.",
        "Use warm sensory details: soft light, quiet sounds, small comforting actions.",
        "Keep it simple and easy to follow.",
      ].join(" ");

    case "whatIf":
      return [
        'Write a playful, imaginative "what if" scenario.',
        "Explore a chain of cause-and-effect in a clear sequence.",
        "Keep it grounded in visual scenes, not abstract explanation.",
        "Make it surprising but understandable.",
      ].join(" ");

    case "history":
      return [
        "Write an interesting, easy-to-follow narrative about a real or highly plausible historical moment.",
        "Focus on one event, one day, or one specific turning point (not a broad timeline).",
        "Anchor the viewer with concrete visuals: locations, tools, clothing, weather, objects, maps, documents.",
        "Avoid sounding like a textbook; make it feel like you are walking through the moment.",
      ].join(" ");

    case "funFacts":
      return [
        "Write a flowing narration that feels like a mini-story but delivers multiple surprising facts about one topic.",
        "Each fact should be shown through a concrete visual example.",
        'Avoid listing; connect facts with small transitions ("Then…", "But here’s the weird part…").',
      ].join(" ");

    case "philosophy":
      return [
        "Write a reflective, thought-provoking story that explores one philosophical idea through a concrete situation.",
        "Show the idea through decisions, objects, small actions, and consequences.",
        "Keep it grounded and relatable; no heavy jargon.",
        "End with a clean, memorable thought (not a lecture).",
      ].join(" ");

    case "motivational":
      return [
        "Write an inspiring story about struggle, persistence, and growth with a clear payoff.",
        "Show progress through visible actions (practice, failure, adjustment, effort) rather than speeches.",
        "End with a clear takeaway that feels earned, not cheesy.",
      ].join(" ");

    case "customPrompt":
      return [
        "Follow the user’s custom prompt strictly and turn it into a coherent narrative.",
        "Do not add random new themes that contradict the prompt.",
        "Keep it visual and easy to animate into scenes.",
      ].join(" ");

    case "random":
      return [
        "Write a creative, surprising short story with a strong hook and satisfying ending.",
        "Keep it very visual and scene-driven.",
        "Avoid random confusion; the ending should still click.",
      ].join(" ");

    default:
      return [
        "Write a short, engaging narrative that is easy to follow and works well as a vertical video voiceover.",
        "Keep it visual and scene-driven.",
      ].join(" ");
  }
}

/* --------- Fallback if OpenAI fails --------- */
function fallbackNarration({ storyType }) {
  const mode = classifyStoryType(storyType);

  if (mode === "scary") {
    return "The elevator doors opened to a floor that didn’t exist on the directory, and the hallway lights blinked as if they were breathing.";
  }
  if (mode === "bedtime") {
    return "A gentle bedtime story where a small lamp glows by the window and the night feels safe and quiet.";
  }
  if (mode === "history") {
    return "A short narration about a specific moment in history, told like a scene you can picture clearly.";
  }
  if (mode === "funFacts") {
    return "A narration that shares several fun facts about one topic, with each fact shown through a clear example.";
  }
  if (mode === "urbanLegend") {
    return "A strange local story people tell like it really happened, ending with an unanswered question.";
  }
  if (mode === "philosophy") {
    return "A reflective story that explores a big question through one ordinary moment and a small decision.";
  }
  if (mode === "motivational") {
    return "A short motivational story about someone struggling at first, improving through effort, and finally succeeding.";
  }
  if (mode === "whatIf") {
    return "A playful “what if” scenario that starts simple and gets more surprising with each step.";
  }

  return "A short, engaging story that works well as a vertical video voiceover.";
}

/* --------- Variety helpers (SOFT, not forced lists) --------- */
function buildSoftDiversityRules(mode) {
  const base = `
Diversity rules (important):
- Choose a fresh setting appropriate to the story type. Do NOT reuse common defaults.
- Vary: setting type, time of day, main character vibe, and the key object/idea driving the plot.
- Avoid repeating the same opening pattern across stories.
- Keep the setting clearly grounded (what room/place, what’s visible, what’s happening).
`.trim();

  const scaryAddon = `
Avoid these overused horror defaults unless the user explicitly asks:
- streetlamp in an alley
- 3:00 AM / 3:07 AM time stamp
- abandoned house in the woods
- shadow figure behind you in a mirror
- TV static / calls from “unknown”
Make tension come from a fresh object, social setting, or public place instead.
`.trim();

  if (mode === "scary" || mode === "urbanLegend") return `${base}\n\n${scaryAddon}`;
  return base;
}

// Optional “structure suggestions” (not mandatory, no finite list)
function buildSoftStructureSuggestions(mode) {
  // Keep this short so it nudges, not forces.
  switch (mode) {
    case "scary":
    case "urbanLegend":
      return `
Structure suggestion (choose one, do NOT mention it explicitly):
- clue trail -> reveal
- normal routine -> subtle wrong detail -> escalation -> twist
- warning/rule -> violation -> consequence -> final image
`.trim();

    case "history":
      return `
Structure suggestion:
- hook the moment -> zoom into 3–5 vivid scenes -> why it mattered (one line)
`.trim();

    case "funFacts":
      return `
Structure suggestion:
- hook -> 3–6 facts shown as mini-scenes -> quick closer
`.trim();

    case "motivational":
      return `
Structure suggestion:
- struggle -> effort loop -> small breakthrough -> payoff -> takeaway
`.trim();

    default:
      return `
Structure suggestion:
- hook -> 3–6 scene beats -> satisfying ending
`.trim();
  }
}

/* --------- POV hook --------- */
function pickOne(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPovHook(mode, povRaw) {
  const p = String(povRaw || "").toLowerCase();
  const wantsPov =
    p.includes("pov") || p.includes("first") || p.includes("second") || p.includes("third");

  if (!wantsPov) {
    if (mode === "scary" || mode === "urbanLegend") {
      return `POV: ${pickOne(['first-person ("I")', 'second-person ("you")', "third-person"])}.`;
    }
    if (mode === "motivational" || mode === "philosophy") {
      return `POV: ${pickOne(['first-person ("I")', "third-person"])}.`;
    }
    return "POV: third-person.";
  }

  if (p.includes("first")) return 'POV: first-person ("I").';
  if (p.includes("second")) return 'POV: second-person ("you").';
  if (p.includes("third")) return "POV: third-person.";
  if (p.includes("pov")) return `POV: ${pickOne(['first-person ("I")', 'second-person ("you")'])}.`;
  return "POV: third-person.";
}

/* --------- Call OpenAI: narration ONLY --------- */
async function callOpenAI({ storyType, artStyle, language, customPrompt, durationRange, pov }) {
  const mode = classifyStoryType(storyType);
  const styleHints = buildStyleHints(mode);

  if (!OPENAI_API_KEY) {
    console.warn("[GENERATE_SCRIPT] Missing OPENAI_API_KEY -> using fallback narration.");
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  // durationRange -> seconds & words
  let minSec = 60;
  let maxSec = 90;
  if (durationRange === "30-60") {
    minSec = 30;
    maxSec = 60;
  }

  // words-per-second estimate
  const minWords = Math.round(minSec * 2.0);
  const maxWords = Math.round(maxSec * 2.8);

  const userTopic =
    mode === "customPrompt" && customPrompt
      ? `Base the story on this user prompt:\n"${customPrompt}"`
      : storyType
      ? `Story type label: ${storyType}`
      : "Story type label: Random AI story";

  const povHook = buildPovHook(mode, pov);

  // ✅ NEW: soft diversity + soft structure (no forced lists)
  const diversityRules = buildSoftDiversityRules(mode);
  const structureSuggestions = buildSoftStructureSuggestions(mode);

  const antiRepetitionRules = `
Anti-repetition rules:
- Don’t reuse the same core setup from other outputs.
- Avoid repeating the same “signature” opening line format.
- Avoid filler phrases unless tied to visible action.
`.trim();

  const extraVisualRules = `
Global rules:
- This will be turned into illustrated scenes.
- Favor concrete visual description over abstract feelings.
- In most sentences mention: environment, lighting/shadows, important objects, and motion.
- Keep it platform-safe: no graphic injury detail.
`.trim();

  const pacingRules = `
Pacing rules:
- Use short sentences most of the time (10–14 words).
- Prefer 1–2 concrete details per sentence, not long lists.
- Every 1–2 sentences should shift visual focus (new object, new area, new action).
- Avoid long monologues. Keep forward motion.
`.trim();

  const formatRules = `
Format rules:
- Do NOT write bullet points.
- Do NOT number beats.
- Write ONE continuous narration for a single voiceover track.
- Return ONLY valid JSON in the exact shape below.
`.trim();

  const prompt = `
You write short scripts for vertical videos (TikTok / Reels / Shorts).

${styleHints}

${povHook}

${diversityRules}

${structureSuggestions}

${antiRepetitionRules}

${extraVisualRules}

${pacingRules}

- Language: ${language || "English"}.
- Art style preference (for visuals only): ${artStyle || "Realistic"}.
- Length: ${minSec}–${maxSec} seconds spoken, roughly ${minWords}–${maxWords} words.

${formatRules}

Return ONLY valid JSON in this exact shape:
{
  "narration": "full voiceover text for the whole video"
}

${userTopic}
`.trim();

  let resp;
  let data;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a JSON-only API. Always return strictly valid JSON with no extra text.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.9,
        top_p: 0.95,
        presence_penalty: 0.6,
        frequency_penalty: 0.4,
      }),
    });

    data = await resp.json().catch(() => ({}));
  } catch (e) {
    console.error("[GENERATE_SCRIPT] Fetch failed -> fallback", e);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  console.log("[GENERATE_SCRIPT] OPENAI_RESPONSE", {
    ok: resp.ok,
    status: resp.status,
    model: OPENAI_MODEL,
    usage: data?.usage || null,
    error: data?.error?.message || null,
  });

  if (!resp.ok) {
    console.error("[GENERATE_SCRIPT] OpenAI error", resp.status, data);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  const raw = data?.choices?.[0]?.message?.content?.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("[GENERATE_SCRIPT] JSON parse failed, raw:", raw);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  const narration = parsed?.narration;
  if (!narration || typeof narration !== "string" || !narration.trim()) {
    console.error("[GENERATE_SCRIPT] Missing narration in JSON:", parsed);
    return { narration: fallbackNarration({ storyType }), usedOpenAI: false };
  }

  return { narration: narration.trim(), usedOpenAI: true };
}

/* --------- HTTP handler --------- */
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const {
      storyType = "Random AI story",
      artStyle = "Realistic",
      language = "English",
      customPrompt = "",
      durationRange = "60-90",
      pov = "",
    } = body;

    const mode = classifyStoryType(storyType);

    console.log("[GENERATE_SCRIPT] INPUT", {
      storyType,
      artStyle,
      language,
      durationRange,
      pov,
      hasCustomPrompt: !!customPrompt,
      hasOpenAIKey: !!OPENAI_API_KEY,
      model: OPENAI_MODEL,
      mode,
    });

    const { narration, usedOpenAI } = await callOpenAI({
      storyType,
      artStyle,
      language,
      customPrompt,
      durationRange,
      pov,
    });

    console.log("[GENERATE_SCRIPT] OUTPUT_PREVIEW", {
      usedOpenAI,
      narrationLen: (narration || "").length,
      preview: (narration || "").slice(0, 140),
    });

    return res.status(200).json({
      storyType,
      artStyle,
      language,
      durationRange,
      pov,
      mode,
      usedOpenAI,
      narration,
    });
  } catch (err) {
    console.error("[GENERATE_SCRIPT] SERVER_ERROR", err);
    return res.status(500).json({
      error: "SERVER_ERROR",
      message: String(err?.message || err),
    });
  }
};
