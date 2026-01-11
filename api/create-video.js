// api/create-video.js (CommonJS, Node 18)

const https = require("https");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const memberstackAdmin = require("@memberstack/admin");

// -------------------- CORS --------------------
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

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// -------------------- API BASE --------------------
const API_BASE = (process.env.API_BASE || "").trim();

// -------------------- Providers --------------------
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || "krea").toLowerCase();

// ---------- Supabase ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

// ---------- Memberstack auth ----------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) throw new Error("MISSING_AUTH");
  if (!ms) throw new Error("MISSING_MEMBERSTACK_SECRET_KEY");

  const { id } = await ms.verifyToken({ token });
  if (!id) throw new Error("INVALID_MEMBER_TOKEN");
  return id;
}

// ---------- OpenAI prompt expander ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const PROMPT_EXPANDER = (process.env.PROMPT_EXPANDER || "openai").toLowerCase();

// (kept for compatibility, but we now expand every beat)
const EXPAND_SHORT_BEATS_ONLY =
  String(process.env.EXPAND_SHORT_BEATS_ONLY || "true").toLowerCase() !== "false";
const EXPAND_WORD_THRESHOLD = Number(process.env.EXPAND_WORD_THRESHOLD || 14);

// ---------- Krea ----------
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL =
  process.env.KREA_GENERATE_URL || "https://api.krea.ai/generate/image/bfl/flux-1-dev";
const KREA_JOB_URL_BASE = process.env.KREA_JOB_URL_BASE || "https://api.krea.ai/jobs";

// Existing default style (your current one)
const KREA_STYLE_ID = (process.env.KREA_STYLE_ID || "tvjlqsab9").trim();
const KREA_STYLE_STRENGTH = Number(process.env.KREA_STYLE_STRENGTH || 0.85);

const KREA_PER_BEAT_RETRIES = Number(process.env.KREA_PER_BEAT_RETRIES || 2);
const KREA_POLL_TRIES = Number(process.env.KREA_POLL_TRIES || 90);
const KREA_POLL_DELAY_MS = Number(process.env.KREA_POLL_DELAY_MS || 2500);

// ✅ Logging toggles
const KREA_LOG_PROMPTS = String(process.env.KREA_LOG_PROMPTS ?? "true").toLowerCase() !== "false";
const KREA_LOG_FULL_PROMPTS = String(process.env.KREA_LOG_FULL_PROMPTS ?? "true").toLowerCase() !== "false";
const KREA_LOG_PROMPT_MAX = Number(process.env.KREA_LOG_PROMPT_MAX || 1200);

// ✅ Visual variety toggle (defaults ON)
const KREA_VARIETY_CUES = String(process.env.KREA_VARIETY_CUES ?? "true").toLowerCase() !== "false";

// ✅ MULTI KREA STYLE MAP (artStyle -> {id, useStyle})
const KREA_STYLE_MAP = {
  // Your new styles (exact keys are matched after lowercasing)
  "whimsical realism": { id: "egcoxayphj", useStyle: true },
  "atmospheric realism": { id: "nagjnorlkq", useStyle: true },
  "lego": { id: "maf9xtl8u", useStyle: true },
  "pixar": { id: "nq1hafccw", useStyle: true },
  "90's anime": { id: "nfiym5rwe", useStyle: true },
  "90s anime": { id: "nfiym5rwe", useStyle: true }, // alias
  "studio ghibli": { id: "hqu5m66ri", useStyle: true },
  "painterly cinema": { id: "53u2ibzsn", useStyle: true },
  "paniterly cinema": { id: "53u2ibzsn", useStyle: true }, // typo-safe alias
  "cinematic noir": { id: "jbfg5nynk", useStyle: true },

  // Realism = base model (no style)
  "realism": { id: "", useStyle: false },
};

function normKey(s) {
  return String(s || "").trim().toLowerCase();
}

// Decide which Krea style config to use for this request.
// - If artStyle matches a known key: use that
// - Else fallback to your existing default KREA_STYLE_ID (styled)
// - Else base model
function pickKreaStyleConfig(artStyle) {
  const key = normKey(artStyle);
  if (KREA_STYLE_MAP[key]) return KREA_STYLE_MAP[key];

  const fallbackId = String(KREA_STYLE_ID || "").trim();
  if (fallbackId) return { id: fallbackId, useStyle: true };

  return { id: "", useStyle: false };
}

// ---------- ElevenLabs ----------
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const VOICE_BUCKET = process.env.VOICE_BUCKET || "voiceovers";

// ---------- Beats ----------
const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT_ESTIMATE = 3.0;
const ANIMATION_VARIANTS = ["PanRight", "PanLeft", "PanUp", "PanDown", "Zoom"];

// ---------- HTTPS JSON helper (Creatomate) ----------
function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(bodyObj);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          Authorization: headers.Authorization,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf || "{}") });
          } catch {
            resolve({ status: res.statusCode, json: { raw: buf } });
          }
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ---------- Text helpers ----------
function countWords(text) {
  return (String(text || "").match(/\S+/g) || []).length;
}
function estimateSpeechSeconds(narration) {
  const text = (narration || "").trim();
  if (!text) return 0;
  return countWords(text) / 2.5;
}
function splitIntoSentences(text) {
  const t = (text || "").trim();
  if (!t) return [];
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return parts.map((s) => s.trim()).filter(Boolean);
}
function splitLongSentence(sentence, maxWords) {
  const words = String(sentence || "").split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [String(sentence).trim()];
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) {
    out.push(words.slice(i, i + maxWords).join(" ").trim());
  }
  return out.filter(Boolean);
}

// ✅ UPDATED: more consistent beat sizing (reduces tiny/huge beats)
function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || "").trim();
  if (!text || beatCount <= 0) return [];

  const totalWords = countWords(text);

  const targetWordsPerBeat = Math.max(12, Math.round(totalWords / beatCount));
  const minWordsPerBeat = Math.max(10, Math.floor(targetWordsPerBeat * 0.7));
  const maxWordsPerBeat = Math.max(18, Math.ceil(targetWordsPerBeat * 1.35));

  let sentences = splitIntoSentences(text);

  // Split long sentences so we don’t get huge beats
  sentences = sentences.flatMap((s) => splitLongSentence(s, maxWordsPerBeat));

  const beats = [];
  let current = [];
  let currentWords = 0;

  for (const s of sentences) {
    const w = countWords(s);

    if (currentWords + w > maxWordsPerBeat && currentWords >= minWordsPerBeat) {
      beats.push(current.join(" ").trim());
      current = [];
      currentWords = 0;
    }

    current.push(s);
    currentWords += w;

    if (currentWords >= targetWordsPerBeat) {
      beats.push(current.join(" ").trim());
      current = [];
      currentWords = 0;
    }
  }

  if (current.join(" ").trim()) beats.push(current.join(" ").trim());

  // Merge down to beatCount
  while (beats.length > beatCount) {
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let i = 0; i < beats.length - 1; i++) {
      const len = countWords(beats[i]) + countWords(beats[i + 1]);
      if (len < bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    beats.splice(bestIdx, 2, `${beats[bestIdx]} ${beats[bestIdx + 1]}`.trim());
  }

  // Pad up to beatCount
  while (beats.length < beatCount) beats.push(beats[beats.length - 1] || text);
  return beats;
}

// ---------- Timing (UPDATED: speech-based + smoothing + normalization) ----------
const WORDS_PER_SECOND = Number(process.env.WORDS_PER_SECOND || 2.6);
const BEAT_PAD_SEC = Number(process.env.BEAT_PAD_SEC || 0.25);

const MIN_BEAT_SEC = Number(process.env.MIN_BEAT_SEC || 2.8);
const MAX_BEAT_SEC = Number(process.env.MAX_BEAT_SEC || 5.4);
const MAX_JUMP_RATIO = Number(process.env.MAX_JUMP_RATIO || 1.35);

function beatDurationFromText(text) {
  const words = countWords(text);
  const speechSeconds = words / WORDS_PER_SECOND;
  const raw = speechSeconds + BEAT_PAD_SEC;
  return Math.max(MIN_BEAT_SEC, Math.min(MAX_BEAT_SEC, raw));
}

function smoothDurations(durations) {
  if (!durations.length) return durations;
  const out = durations.slice();
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const maxUp = prev * MAX_JUMP_RATIO;
    const minDown = prev / MAX_JUMP_RATIO;
    out[i] = Math.max(minDown, Math.min(maxUp, out[i]));
  }
  return out;
}

function normalizeToTotal(durations, targetTotalSec) {
  const sum = durations.reduce((a, b) => a + b, 0) || 1;
  const scale = targetTotalSec / sum;
  return durations.map((d) => d * scale);
}

function buildBeatTiming(beatTexts, targetTotalSec) {
  let durations = beatTexts.map(beatDurationFromText);

  durations = smoothDurations(durations);

  if (Number.isFinite(targetTotalSec) && targetTotalSec > 0) {
    durations = normalizeToTotal(durations, targetTotalSec);

    // Re-clamp after normalization
    durations = durations.map((d) => Math.max(MIN_BEAT_SEC, Math.min(MAX_BEAT_SEC, d)));
    durations = smoothDurations(durations);
  }

  let t = 0;
  const starts = durations.map((d) => {
    const s = t;
    t += d;
    return s;
  });

  return { durations, starts, total: t };
}

// ---------- OpenAI prompt expander (UPDATED: turns narration into a real scene prompt) ----------
async function expandBeatToVisualPrompt(beatText) {
  const text = String(beatText || "").trim();
  if (!text) return "";
  if (!OPENAI_API_KEY || PROMPT_EXPANDER !== "openai") return text;

  const instruction = `
Rewrite the narration line into a vivid visual prompt for an image generator.

Output rules:
- Output ONLY the prompt (no quotes, no labels, no JSON).
- Do NOT write in first person. Do NOT include dialogue.
- Start with a short establishing sentence naming the scene.
- Then add 2–4 sentences with concrete visual details: setting, lighting, objects, mood (shown visually), spatial layout.
- Avoid camera terms and hype words like: cinematic, realistic, photorealistic, 8k, masterpiece.

Narration line:
"${text}"
  `.trim();

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: "You output only the final prompt text. No JSON. No extra text." },
        { role: "user", content: instruction },
      ],
      temperature: 0.8,
      top_p: 0.95,
      presence_penalty: 0.35,
      frequency_penalty: 0.2,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("[PROMPT_EXPANDER] OpenAI failed", resp.status, data?.error || data);
    return text;
  }

  const out = String(data?.choices?.[0]?.message?.content || "").trim();
  return out || text;
}

// ---------- Krea helpers ----------
function shortPrompt(p) {
  const s = String(p || "").replace(/\s+/g, " ").trim();
  return s.length > 180 ? s.slice(0, 180) + "..." : s;
}

function pickVariationCue(i) {
  const cues = [
    "wide aisle-level view, strong depth",
    "tight detail on a single object in the scene",
    "overhead angle showing the layout",
    "view from behind a foreground object, partially obscured",
    "side angle with strong shadows and negative space",
    "focus on hands interacting with something in the scene",
    "scene framed through glass or reflections",
    "low angle near the floor, long lines leading forward",
    "centered composition with symmetrical lines and clean geometry",
    "off-center framing with a strong light source on one side",
  ];
  return cues[(i - 1) % cues.length];
}

function logPromptForKrea({ requestId, beatIndex, beatText, expanded, prompt, aspectRatio, varietyCue, styleId, useStyle }) {
  if (!KREA_LOG_PROMPTS) return;

  const safePrompt = String(prompt || "");
  const safeBeat = String(beatText || "");

  const fullOrShort = KREA_LOG_FULL_PROMPTS
    ? safePrompt.slice(0, Math.max(0, KREA_LOG_PROMPT_MAX))
    : shortPrompt(safePrompt);

  console.log("[KREA_PROMPT]", {
    requestId,
    beat: beatIndex,
    aspectRatio,
    expanded,
    varietyCue: varietyCue || null,
    useStyle: !!useStyle,
    styleId: useStyle ? String(styleId || "").trim() : null,
    beatText: safeBeat.length > 260 ? safeBeat.slice(0, 260) + "..." : safeBeat,
    prompt: fullOrShort,
    promptLen: safePrompt.length,
    beatWords: countWords(safeBeat),
    promptWords: countWords(safePrompt),
    emptyPrompt: !safePrompt.trim(),
  });
}

// ✅ UPDATED: supports passing styleId (and can disable style entirely)
async function createKreaJob({ prompt, aspectRatio, useStyle, styleId, requestId, beatIndex }) {
  if (!KREA_API_KEY) throw new Error("KREA_API_KEY not set");

  const payload = { prompt, aspect_ratio: aspectRatio };

  if (useStyle) {
    const sid = String(styleId || "").trim();
    if (!sid) throw new Error("KREA_STYLE_ID not set");
    payload.styles = [{ id: sid, strength: KREA_STYLE_STRENGTH }];
  }

  if (KREA_LOG_PROMPTS) {
    console.log("[KREA_REQUEST]", {
      requestId,
      beat: beatIndex,
      url: KREA_GENERATE_URL,
      useStyle: !!useStyle,
      styleId: useStyle ? String(styleId || "").trim() : null,
      styleStrength: useStyle ? KREA_STYLE_STRENGTH : null,
      payload,
    });
  }

  const resp = await fetch(KREA_GENERATE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error("[KREA_GENERATE_ERROR]", {
      requestId,
      beat: beatIndex,
      status: resp.status,
      data,
      useStyle: !!useStyle,
      styleId: useStyle ? String(styleId || "").trim() : null,
      aspectRatio,
      prompt: shortPrompt(prompt),
      payloadKeys: Object.keys(payload),
    });
    throw new Error(`KREA_GENERATE_FAILED (${resp.status})`);
  }

  const jobId = data?.job_id || data?.id;
  if (!jobId) {
    console.error("[KREA_MISSING_JOB_ID]", { requestId, beat: beatIndex, data, useStyle: !!useStyle, prompt: shortPrompt(prompt) });
    throw new Error("KREA_MISSING_JOB_ID");
  }

  return jobId;
}

async function pollKreaJob(jobId, { requestId, beatIndex } = {}) {
  const url = `${KREA_JOB_URL_BASE}/${encodeURIComponent(jobId)}`;

  for (let i = 0; i < KREA_POLL_TRIES; i++) {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${KREA_API_KEY}` },
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[KREA_JOB_LOOKUP_FAILED]", { requestId, beat: beatIndex, status: resp.status, data, jobId });
      throw new Error(`KREA_JOB_LOOKUP_FAILED (${resp.status})`);
    }

    const status = String(data?.status || "").toLowerCase();

    if (status === "completed" || status === "complete" || status === "succeeded") {
      const urls = data?.result?.urls || data?.urls || [];
      const imageUrl = Array.isArray(urls) ? urls[0] : null;

      if (!imageUrl) {
        console.error("[KREA_JOB_NO_RESULT_URL]", { requestId, beat: beatIndex, jobId, data });
        throw new Error("KREA_JOB_NO_RESULT_URL");
      }
      return imageUrl;
    }

    if (status === "failed" || status === "error") {
      console.error("[KREA_JOB_FAILED]", { requestId, beat: beatIndex, jobId, data });
      throw new Error(`KREA_JOB_FAILED (${jobId})`);
    }

    await new Promise((r) => setTimeout(r, KREA_POLL_DELAY_MS));
  }

  throw new Error("KREA_JOB_TIMEOUT");
}

// ✅ UPDATED: accepts styleId/useStyle and uses them (with fallback attempts)
async function generateOneImageWithRetry({ prompt, aspectRatio, beatIndex, requestId, useStyle, styleId }) {
  // First: try with chosen style config (could be base model if useStyle=false)
  for (let attempt = 1; attempt <= Math.max(1, KREA_PER_BEAT_RETRIES); attempt++) {
    try {
      const jobId = await createKreaJob({
        prompt,
        aspectRatio,
        useStyle: !!useStyle,
        styleId,
        requestId,
        beatIndex,
      });
      return await pollKreaJob(jobId, { requestId, beatIndex });
    } catch (e) {
      console.error("[KREA_RETRY_PRIMARY]", {
        requestId,
        beat: beatIndex,
        attempt,
        maxAttempts: KREA_PER_BEAT_RETRIES,
        aspectRatio,
        useStyle: !!useStyle,
        styleId: useStyle ? String(styleId || "").trim() : null,
        prompt: shortPrompt(prompt),
        message: String(e?.message || e),
      });
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }

  // Second: fall back to NO STYLE always (base model)
  for (let attempt = 1; attempt <= Math.max(1, KREA_PER_BEAT_RETRIES); attempt++) {
    try {
      const jobId = await createKreaJob({
        prompt,
        aspectRatio,
        useStyle: false,
        styleId,
        requestId,
        beatIndex,
      });
      return await pollKreaJob(jobId, { requestId, beatIndex });
    } catch (e) {
      console.error("[KREA_RETRY_NO_STYLE]", {
        requestId,
        beat: beatIndex,
        attempt,
        maxAttempts: KREA_PER_BEAT_RETRIES,
        aspectRatio,
        prompt: shortPrompt(prompt),
        message: String(e?.message || e),
      });
      await new Promise((r) => setTimeout(r, 1200 * attempt));
    }
  }

  throw new Error("KREA_FAILED_AFTER_RETRIES");
}

// ✅ UPDATED: receives style config once per video
async function generateKreaImageUrlsForBeats({ beatCount, beatTexts, aspectRatio, requestId, useStyle, styleId }) {
  const urls = [];

  if (KREA_LOG_PROMPTS) {
    console.log("[KREA_BATCH]", {
      requestId,
      beatCount,
      aspectRatio,
      expandShortBeatsOnly: EXPAND_SHORT_BEATS_ONLY,
      expandWordThreshold: EXPAND_WORD_THRESHOLD,
      varietyCues: KREA_VARIETY_CUES,
      generateUrl: KREA_GENERATE_URL,
      jobUrlBase: KREA_JOB_URL_BASE,
      useStyle: !!useStyle,
      styleId: useStyle ? String(styleId || "").trim() : null,
      styleStrength: useStyle ? KREA_STYLE_STRENGTH : null,
    });
  }

  for (let i = 1; i <= beatCount; i++) {
    const beatText = (beatTexts[i - 1] || "").trim();

    // ✅ ALWAYS expand into a real visual prompt
    let prompt = await expandBeatToVisualPrompt(beatText);

    // ✅ Add a variation cue so images don't all look the same
    const varietyCue = KREA_VARIETY_CUES ? pickVariationCue(i) : "";
    if (varietyCue) {
      prompt = `${prompt}\n\nComposition cue: ${varietyCue}. Keep this scene visually distinct from previous ones.`;
    }

    logPromptForKrea({
      requestId,
      beatIndex: i,
      beatText,
      expanded: true,
      prompt,
      aspectRatio,
      varietyCue,
      styleId,
      useStyle,
    });

    const imageUrl = await generateOneImageWithRetry({
      prompt,
      aspectRatio,
      beatIndex: i,
      requestId,
      useStyle,
      styleId,
    });

    urls.push(imageUrl);
  }

  return urls;
}

// ---------- Variants ----------
function buildVariantSequence(beatCount) {
  const seq = [];
  let last = null;
  for (let i = 0; i < beatCount; i++) {
    const available = ANIMATION_VARIANTS.filter((v) => v !== last);
    const chosen = available[i % available.length];
    seq.push(chosen);
    last = chosen;
  }
  return seq;
}

// =====================================================
// Captions: styles + settings
// =====================================================
const CAPTION_STYLE_TO_LAYER = {
  sentence: "Subtitles_Sentence",
  karaoke: "Subtitles_Karaoke",
  word: "Subtitles_Word",
  boldwhite: "Subtitles_BoldWhite",
  yellowpop: "Subtitles_YellowPop",
  minttag: "Subtitles_MintTag",
  outlinepunch: "Subtitles_OutlinePunch",
  blackbar: "Subtitles_BlackBar",
  highlighter: "Subtitles_Highlighter",
  neonglow: "Subtitles_NeonGlow",
  purplepop: "Subtitles_PurplePop",
  compactlowerthird: "Subtitles_CompactLowerThird",
  bouncepop: "Subtitles_BouncePop",
  redalert: "Subtitles_RedAlert",
  redtag: "Subtitles_RedTag",
};

const ACTIVE_COLOR_STYLES = new Set(["karaoke", "yellowpop", "minttag", "highlighter", "purplepop", "redtag"]);

function normCaptionStyle(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "karoke") return "karaoke";
  return s || "sentence";
}
function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(min, Math.min(max, x));
}
function asPercent(n, fallback) {
  const c = clamp(n, 0, 100);
  const v = c === null ? fallback : c;
  return `${v}%`;
}
function safeColor(v, fallback) {
  const s = String(v || "").trim();
  return s || fallback;
}
function safeTextTransform(v) {
  const s = String(v || "none").trim().toLowerCase();
  return ["none", "uppercase", "lowercase", "capitalize"].includes(s) ? s : "none";
}
function safePx(n, fallback) {
  const c = clamp(n, 0, 60);
  const v = c === null ? fallback : c;
  return `${v}px`;
}

function captionVisibilityMods(captionStyle) {
  const style = normCaptionStyle(captionStyle);
  const mods = { "Subtitles-1.visible": false };
  for (const layer of Object.values(CAPTION_STYLE_TO_LAYER)) mods[`${layer}.visible`] = false;
  const layer = CAPTION_STYLE_TO_LAYER[style] || CAPTION_STYLE_TO_LAYER.sentence;
  mods[`${layer}.visible`] = true;
  return mods;
}

function captionSettingsMods(captionStyle, captionSettings) {
  const style = normCaptionStyle(captionStyle);
  const layer = CAPTION_STYLE_TO_LAYER[style] || CAPTION_STYLE_TO_LAYER.sentence;

  const cs = captionSettings && typeof captionSettings === "object" ? captionSettings : {};
  const x = asPercent(cs.x, 50);
  const y = asPercent(cs.y, 50);

  const fontFamily = String(cs.fontFamily || "Inter").trim();
  const fontWeight = clamp(cs.fontWeight, 100, 1000);
  const fillColor = safeColor(cs.fillColor, "#FFFFFF");
  const strokeColor = safeColor(cs.strokeColor, "#000000");
  const strokeWidth = safePx(cs.strokeWidth, 0);
  const textTransform = safeTextTransform(cs.textTransform);
  const activeColor = safeColor(cs.activeColor, "#A855F7");

  const mods = {};
  mods[`${layer}.x_alignment`] = x;
  mods[`${layer}.y_alignment`] = y;
  if (fontFamily) mods[`${layer}.font_family`] = fontFamily;
  if (fontWeight !== null) mods[`${layer}.font_weight`] = fontWeight;

  mods[`${layer}.fill_color`] = fillColor;
  mods[`${layer}.stroke_color`] = strokeColor;
  mods[`${layer}.stroke_width`] = strokeWidth;
  mods[`${layer}.text_transform`] = textTransform;

  if (ACTIVE_COLOR_STYLES.has(style)) mods[`${layer}.transcript_color`] = activeColor;
  return mods;
}

// =====================================================
// ElevenLabs -> MP3 Buffer
// =====================================================
async function elevenlabsTTS({ voiceId, text }) {
  if (!ELEVENLABS_API_KEY) throw new Error("MISSING_ELEVENLABS_API_KEY");
  if (!voiceId) throw new Error("MISSING_VOICE_ID");

  const t = String(text || "").trim();
  if (!t) throw new Error("MISSING_TTS_TEXT");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: t,
      model_id: ELEVENLABS_MODEL_ID,
      voice_settings: { stability: 0.4, similarity_boost: 0.85 },
    }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`ELEVENLABS_TTS_FAILED (${r.status}) ${msg}`);
  }

  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("ELEVENLABS_EMPTY_AUDIO");
  return buf;
}

async function isUrlFetchable(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

// Upload MP3 -> return a URL Creatomate can fetch
async function uploadVoiceMp3({ db_id, mp3Buffer }) {
  if (!supabase) throw new Error("MISSING_SUPABASE_ENV_VARS");

  const path = `${db_id}/voice.mp3`;

  const { error: upErr } = await supabase.storage.from(VOICE_BUCKET).upload(path, mp3Buffer, {
    contentType: "audio/mpeg",
    upsert: true,
    cacheControl: "3600",
  });

  if (upErr) {
    console.error("[VOICE_UPLOAD_FAILED]", upErr);
    throw new Error("VOICE_UPLOAD_FAILED");
  }

  // Try public URL first
  const pub = supabase.storage.from(VOICE_BUCKET).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl || "";

  // If bucket isn't public, publicUrl often 404/401 for Creatomate. Fall back to signed URL.
  if (publicUrl && (await isUrlFetchable(publicUrl))) return publicUrl;

  const { data: signed, error: signErr } = await supabase.storage
    .from(VOICE_BUCKET)
    .createSignedUrl(path, 60 * 60); // 1 hour

  if (signErr || !signed?.signedUrl) {
    console.error("[VOICE_SIGNED_URL_FAILED]", signErr);
    // last resort: return publicUrl even if not fetchable (for debugging)
    return publicUrl;
  }

  return signed.signedUrl;
}

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  // ✅ correlation id for logs
  const requestId = crypto.randomUUID();

  try {
    const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
    const memberId = await requireMemberId(req);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      storyType = "Random AI story",
      artStyle = "Scary toon",
      language = "English",

      voiceId = "",
      voiceName = "Voice",

      aspectRatio = "9:16",
      customPrompt = "",
      durationRange = "60-90",

      captionStyle = "sentence",
      captionSettings = {},
    } = body;

    if (!process.env.CREATOMATE_API_KEY) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!supabase) return res.status(500).json({ error: "MISSING_SUPABASE_ENV_VARS" });

    const templateMap = {
      "9:16": process.env.CREATO_TEMPLATE_916,
      "1:1": process.env.CREATO_TEMPLATE_11,
      "16:9": process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || "").trim();
    if (!template_id) return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspectRatio });

    const styleNorm = normCaptionStyle(captionStyle);

    const choices = {
      storyType,
      artStyle,
      language,
      voiceId,
      voiceName,
      aspectRatio,
      customPrompt,
      durationRange,
      captionStyle: styleNorm,
      captionSettings: captionSettings && typeof captionSettings === "object" ? captionSettings : {},
    };

    const db_id = crypto.randomUUID();

    const { error: preInsErr } = await supabase.from("renders").insert([
      {
        id: db_id,
        member_id: String(memberId),
        status: "waiting",
        video_url: null,
        render_id: "pending",
        choices,
        error: null,
      },
    ]);

    if (preInsErr) {
      console.error("[DB_PREINSERT_FAILED]", { requestId, error: preInsErr });
      return res.status(500).json({ error: "DB_PREINSERT_FAILED", details: preInsErr });
    }

    // Script
    const scriptResp = await fetch(`${publicBaseUrl}/api/generate-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyType, artStyle, language, customPrompt, durationRange }),
    }).then((r) => r.json());

    const narration = String(scriptResp?.narration || "").trim();
    if (!narration) {
      await supabase.from("renders").update({ status: "failed", error: JSON.stringify(scriptResp || {}) }).eq("id", db_id);
      return res.status(502).json({ error: "SCRIPT_EMPTY", details: scriptResp });
    }

    // Voice MP3 -> URL
    let voiceUrl = "";
    if (voiceId) {
      try {
        const mp3 = await elevenlabsTTS({ voiceId, text: narration });
        voiceUrl = await uploadVoiceMp3({ db_id, mp3Buffer: mp3 });
      } catch (e) {
        console.error("[VOICEOVER_FAILED]", { requestId, voiceId, message: String(e?.message || e) });
        voiceUrl = "";
      }
    }

    // Beats + timing
    const speechSec = estimateSpeechSeconds(narration);
    let targetSec = Math.round(speechSec + 2);

    let minSec = 60,
      maxSec = 90;
    if (durationRange === "30-60") {
      minSec = 30;
      maxSec = 60;
    }

    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec) targetSec = maxSec;

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT_ESTIMATE);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // ✅ timing uses speech-based durations + smoothing + normalization
    const timing = buildBeatTiming(beatTexts, targetSec);

    console.log("[TIMING_DEBUG]", {
      requestId,
      beatCount,
      targetSec,
      speechSec: Number(speechSec.toFixed(2)),
      totalSec: Number(timing.total.toFixed(2)),
      durations: timing.durations.map((d) => Number(d.toFixed(2))),
    });

    // ✅ Pick Krea style once per render (based on artStyle)
    const kreaStyle = pickKreaStyleConfig(artStyle);

    console.log("[KREA_STYLE_PICK]", {
      requestId,
      artStyle,
      useStyle: !!kreaStyle.useStyle,
      styleId: kreaStyle.useStyle ? String(kreaStyle.id || "").trim() : null,
    });

    // Images
    let imageUrls = [];
    if (IMAGE_PROVIDER === "krea") {
      imageUrls = await generateKreaImageUrlsForBeats({
        beatCount,
        beatTexts,
        aspectRatio,
        requestId,
        useStyle: kreaStyle.useStyle,
        styleId: kreaStyle.id,
      });
    }

    const variantSequence = buildVariantSequence(beatCount);

    // ✅ Creatomate mods
    const mods = {
      Narration: narration,
      VoiceLabel: voiceName || "Voice",
      LanguageLabel: language,
      StoryTypeLabel: storyType,

      // ✅ Creatomate media elements use ".source"
      "Voiceover.source": voiceUrl || "",

      ...captionVisibilityMods(styleNorm),
      ...captionSettingsMods(styleNorm, captionSettings),
    };

    // Timing mods
    for (let i = 1; i <= beatCount; i++) {
      const start = timing.starts[i - 1];
      const dur = timing.durations[i - 1];

      mods[`Beat${i}_Scene.start`] = start;
      mods[`Beat${i}_Scene.duration`] = dur;
      mods[`Beat${i}_Group.start`] = 0;
      mods[`Beat${i}_Group.duration`] = dur;
    }

    // Clear unused beats
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Scene.start`] = 0;
      mods[`Beat${i}_Scene.duration`] = 0;
      mods[`Beat${i}_Group.start`] = 0;
      mods[`Beat${i}_Group.duration`] = 0;
      for (const variant of ANIMATION_VARIANTS) mods[`Beat${i}_${variant}_Image.source`] = "";
    }

    // Image assignment
    let lastGood = "";
    for (let i = 1; i <= beatCount; i++) {
      const raw = imageUrls[i - 1] || "";
      let proxied = raw ? `${publicBaseUrl}/api/krea-image?url=${encodeURIComponent(raw)}` : "";
      if (!proxied && lastGood) proxied = lastGood;
      if (proxied) lastGood = proxied;

      const chosen = i === 1 ? "PanRight" : variantSequence[i - 1];
      for (const variant of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${variant}_Image.source`] = variant === chosen ? proxied : "";
      }
    }

    const payload = {
      template_id,
      modifications: mods,
      output_format: "mp4",
      webhook_url: `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(db_id)}&kind=main`,
    };

    const resp = await postJSON(
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    if (resp.status !== 202 && resp.status !== 200) {
      await supabase.from("renders").update({ status: "failed", error: JSON.stringify(resp.json || {}) }).eq("id", db_id);
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: resp.json });
    }

    const job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
    if (!job_id) {
      await supabase.from("renders").update({ status: "failed", error: "NO_JOB_ID_IN_RESPONSE" }).eq("id", db_id);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: resp.json });
    }

    const { error: updErr } = await supabase.from("renders").update({ render_id: String(job_id) }).eq("id", db_id);
    if (updErr) console.error("[DB_UPDATE_RENDER_ID_FAILED]", { requestId, error: updErr });

    return res.status(200).json({
      ok: true,
      job_id,
      db_id,
      captionStyle: styleNorm,
      voiceUrl: voiceUrl || null,
      kreaStyle: {
        artStyle,
        useStyle: !!kreaStyle.useStyle,
        styleId: kreaStyle.useStyle ? String(kreaStyle.id || "").trim() : null,
      },
      requestId,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: msg });
    }
    console.error("[CREATE_VIDEO] SERVER_ERROR", { requestId, err });
    return res.status(500).json({ error: "SERVER_ERROR", message: msg, requestId });
  }
};
