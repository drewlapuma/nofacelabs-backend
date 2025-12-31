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
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

// ---------- Memberstack ----------
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

// ---------- Krea (unchanged) ----------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const PROMPT_EXPANDER = (process.env.PROMPT_EXPANDER || "openai").toLowerCase();
const EXPAND_SHORT_BEATS_ONLY =
  String(process.env.EXPAND_SHORT_BEATS_ONLY || "true").toLowerCase() !== "false";
const EXPAND_WORD_THRESHOLD = Number(process.env.EXPAND_WORD_THRESHOLD || 14);

const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL =
  process.env.KREA_GENERATE_URL || "https://api.krea.ai/generate/image/bfl/flux-1-dev";
const KREA_JOB_URL_BASE = process.env.KREA_JOB_URL_BASE || "https://api.krea.ai/jobs";
const KREA_STYLE_ID = (process.env.KREA_STYLE_ID || "tvjlqsab9").trim();
const KREA_STYLE_STRENGTH = Number(process.env.KREA_STYLE_STRENGTH || 0.85);

const KREA_PER_BEAT_RETRIES = Number(process.env.KREA_PER_BEAT_RETRIES || 2);
const KREA_POLL_TRIES = Number(process.env.KREA_POLL_TRIES || 90);
const KREA_POLL_DELAY_MS = Number(process.env.KREA_POLL_DELAY_MS || 2500);

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
  for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(" ").trim());
  return out.filter(Boolean);
}
function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || "").trim();
  if (!text || beatCount <= 0) return [];

  const totalWords = countWords(text);
  const targetWordsPerBeat = Math.max(8, Math.round(totalWords / beatCount));

  let sentences = splitIntoSentences(text);
  const maxSentenceWords = Math.max(18, targetWordsPerBeat * 2);
  sentences = sentences.flatMap((s) => splitLongSentence(s, maxSentenceWords));

  const beats = [];
  let current = "";
  let currentWords = 0;

  for (const s of sentences) {
    const w = countWords(s);
    if (current && currentWords + w > targetWordsPerBeat) {
      beats.push(current.trim());
      current = "";
      currentWords = 0;
    }
    current += (current ? " " : "") + s;
    currentWords += w;
  }
  if (current.trim()) beats.push(current.trim());

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

  while (beats.length < beatCount) beats.push(beats[beats.length - 1] || text);
  return beats;
}

function beatDurationFromText(text) {
  const words = countWords(text);
  const speechSeconds = words / 2.5;
  const padded = speechSeconds + 0.6;
  return Math.max(2.5, Math.min(7.0, padded));
}
function buildBeatTiming(beatTexts) {
  const durations = beatTexts.map(beatDurationFromText);
  let t = 0;
  const starts = durations.map((d) => {
    const s = t;
    t += d;
    return s;
  });
  return { durations, starts, total: t };
}

// ---------- Captions visibility (FIRST RENDER = ONE DEFAULT ONLY) ----------
function mainSubtitleMods(captionStyle) {
  const style = String(captionStyle || "sentence").toLowerCase();

  // turn everything OFF first (including fallback)
  const mods = {
    "Subtitles_Sentence.visible": false,
    "Subtitles_Karaoke.visible": false,
    "Subtitles_Word.visible": false,
    "Subtitles-1.visible": false,
  };

  // then turn on only ONE
  if (style === "karaoke") mods["Subtitles_Karaoke.visible"] = true;
  else if (style === "word") mods["Subtitles_Word.visible"] = true;
  else mods["Subtitles_Sentence.visible"] = true;

  return mods;
}

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
    const memberId = await requireMemberId(req);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      storyType = "Random AI story",
      artStyle = "Scary toon",
      language = "English",
      voice = "Adam",
      aspectRatio = "9:16",
      customPrompt = "",
      durationRange = "60-90",
      captionStyle = "sentence",
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

    const choices = { storyType, artStyle, language, voice, aspectRatio, customPrompt, durationRange, captionStyle };
    const db_id = crypto.randomUUID();

    // ✅ preinsert ONLY known columns (no caption_* fields)
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
      console.error("[DB_PREINSERT_FAILED]", preInsErr);
      return res.status(500).json({ error: "DB_PREINSERT_FAILED", details: preInsErr });
    }

    // Generate script
    const scriptResp = await fetch(`${publicBaseUrl}/api/generate-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyType, artStyle, language, customPrompt, durationRange }),
    }).then((r) => r.json());

    const narration = (scriptResp && scriptResp.narration) || "";
    if (!narration.trim()) {
      await supabase.from("renders").update({ status: "failed", error: JSON.stringify(scriptResp || {}) }).eq("id", db_id);
      return res.status(502).json({ error: "SCRIPT_EMPTY", details: scriptResp });
    }

    // Beats + timing
    const speechSec = estimateSpeechSeconds(narration);
    let targetSec = Math.round(speechSec + 2);

    let minSec = 60, maxSec = 90;
    if (durationRange === "30-60") { minSec = 30; maxSec = 60; }

    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec) targetSec = maxSec;

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT_ESTIMATE);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);
    const timing = buildBeatTiming(beatTexts);

    // Images (unchanged)
    let imageUrls = [];
    if (IMAGE_PROVIDER === "krea") {
      imageUrls = await generateKreaImageUrlsForBeats({ beatCount, beatTexts, aspectRatio });
    }

    const variantSequence = buildVariantSequence(beatCount);

    // Creatomate mods
    const mods = {
      Narration: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      Voiceover: narration,
      VoiceUrl: null,

      // ✅ ensures ONLY ONE default captions layer shows on first render
      ...mainSubtitleMods(captionStyle),
    };

    for (let i = 1; i <= beatCount; i++) {
      const start = timing.starts[i - 1];
      const dur = timing.durations[i - 1];

      mods[`Beat${i}_Scene.start`] = start;
      mods[`Beat${i}_Scene.duration`] = dur;
      mods[`Beat${i}_Group.start`] = 0;
      mods[`Beat${i}_Group.duration`] = dur;
    }

    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Scene.start`] = 0;
      mods[`Beat${i}_Scene.duration`] = 0;
      mods[`Beat${i}_Group.start`] = 0;
      mods[`Beat${i}_Group.duration`] = 0;
      for (const variant of ANIMATION_VARIANTS) mods[`Beat${i}_${variant}_Image.source`] = "";
    }

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

    await supabase.from("renders").update({ render_id: String(job_id) }).eq("id", db_id);

    return res.status(200).json({ ok: true, job_id, db_id, captionStyle });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: msg });
    }
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: msg });
  }
};
