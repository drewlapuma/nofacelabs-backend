// api/reddit-video.js (CommonJS, Node 18 on Vercel)
//
// ✅ Generates a "Reddit-style" video:
//  - Intro post card (light/dark) shown ONLY for the time it takes to read post_text
//  - Voice A reads the post_text (post_voice audio element)
//  - Voice B reads the generated script (script_voice audio element)
//  - Gameplay background (library or uploaded URL) behind everything
//  - Captions use your existing caption styles/settings (applied to your captions layers)
//
// REQUIRED Creatomate layer names in your 9:16 template:
//  - bg_video (video)
//  - post_card_light (group)
//  - post_card_dark  (group)
//  - pfp (image)
//  - username (text)
//  - post_text (text)
//  - like_count (text)
//  - comment_count (text)
//  - post_voice (audio)
//  - script_voice (audio)
//  - captions layers: same naming as your existing CAPTION_STYLE_TO_LAYER values
//
// ENV VARS needed:
//  - CREATOMATE_API_KEY
//  - CREATO_REDDIT_TEMPLATE_916   (your 9:16 reddit template id)
//  - SUPABASE_URL
//  - SUPABASE_SERVICE_ROLE_KEY
//  - MEMBERSTACK_SECRET_KEY
//  - ELEVENLABS_API_KEY
//  - (optional) ELEVENLABS_MODEL_ID
//  - (optional) VOICE_BUCKET (default "voiceovers")
//  - OPENAI_API_KEY
//  - (optional) OPENAI_MODEL (default "gpt-4.1-mini")
//  - (optional) API_BASE  (otherwise uses https://{host})

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

// ---------- Creatomate ----------
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

// ---------- Helpers ----------
function clampNum(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function countWords(text) {
  return (String(text || "").match(/\S+/g) || []).length;
}

// Intro length ≈ how long it takes to read post text
function estimateIntroSeconds(postText) {
  // ~2.7 words/sec + 0.5s padding, clamped
  const words = countWords(postText);
  const s = words / 2.7 + 0.5;
  return clampNum(s, 3.5, 10);
}

// -------------------- OpenAI (script generation) --------------------
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();

function mapTone(toneRaw) {
  const t = String(toneRaw || "").trim().toLowerCase();
  if (t.includes("dram")) return "Dramatic";
  if (t.includes("seri")) return "Serious";
  return "Funny";
}

function mapDurationSeconds(durationRaw) {
  // accepts: "45s", "1 min", "1 min 30s", 45, 60, 90, etc.
  const s = String(durationRaw || "").toLowerCase();
  if (s.includes("90") || s.includes("1:30") || s.includes("1 min 30") || s.includes("1min30")) return 90;
  if (s.includes("60") || s.includes("1 min") || s.includes("1min")) return 60;
  if (s.includes("45")) return 45;

  const n = Number(durationRaw);
  if (Number.isFinite(n)) return clampNum(n, 30, 90);

  return 60;
}

async function generateScriptFromTopic({ topic, tone, targetSeconds }) {
  if (!OPENAI_API_KEY) throw new Error("MISSING_OPENAI_API_KEY");

  const safeTopic = String(topic || "").trim();
  if (!safeTopic) throw new Error("MISSING_TOPIC");

  const safeTone = mapTone(tone);
  const seconds = clampNum(targetSeconds, 30, 90);

  const instruction = `
Write a short-form story script based on the topic below.

Topic:
${safeTopic}

Tone:
${safeTone}

Rules:
- Write in a natural spoken voiceover style.
- Do NOT reference Reddit, subreddits, or usernames.
- Do NOT include emojis.
- Do NOT include stage directions.
- Keep it engaging and easy to follow.
- Avoid extreme or graphic details.

Target length:
${seconds} seconds.

Output ONLY the script text.
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
        { role: "system", content: "You output only the final script text. No JSON. No extra commentary." },
        { role: "user", content: instruction },
      ],
      temperature: safeTone === "Funny" ? 0.9 : 0.75,
      top_p: 0.95,
      presence_penalty: 0.35,
      frequency_penalty: 0.2,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("[OPENAI_SCRIPT_FAILED]", resp.status, data?.error || data);
    throw new Error(`OPENAI_SCRIPT_FAILED (${resp.status})`);
  }

  const out = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!out) throw new Error("OPENAI_SCRIPT_EMPTY");
  return out;
}

// -------------------- ElevenLabs (copied from your create-video.js) --------------------
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const VOICE_BUCKET = process.env.VOICE_BUCKET || "voiceovers";

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

// Upload MP3 -> return URL Creatomate can fetch
async function uploadVoiceMp3({ path, mp3Buffer }) {
  if (!supabase) throw new Error("MISSING_SUPABASE_ENV_VARS");

  const { error: upErr } = await supabase.storage.from(VOICE_BUCKET).upload(path, mp3Buffer, {
    contentType: "audio/mpeg",
    upsert: true,
    cacheControl: "3600",
  });

  if (upErr) {
    console.error("[VOICE_UPLOAD_FAILED]", upErr);
    throw new Error("VOICE_UPLOAD_FAILED");
  }

  const pub = supabase.storage.from(VOICE_BUCKET).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl || "";

  if (publicUrl && (await isUrlFetchable(publicUrl))) return publicUrl;

  const { data: signed, error: signErr } = await supabase.storage
    .from(VOICE_BUCKET)
    .createSignedUrl(path, 60 * 60); // 1 hour

  if (signErr || !signed?.signedUrl) {
    console.error("[VOICE_SIGNED_URL_FAILED]", signErr);
    return publicUrl;
  }

  return signed.signedUrl;
}

// =====================================================
// Captions: styles + settings (same as your create-video.js)
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

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const requestId = crypto.randomUUID();

  try {
    const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
    const memberId = await requireMemberId(req);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    // ---- Inputs ----
    const theme = String(body.theme || "dark").toLowerCase() === "light" ? "light" : "dark";

    const username = String(body.username || "placeholder").trim() || "placeholder";
    const postText = String(body.post_text || body.postText || "").trim();
    const likeCount = String(body.like_count ?? body.likeCount ?? "99+").trim() || "99+";
    const commentCount = String(body.comment_count ?? body.commentCount ?? "99+").trim() || "99+";
    const pfpUrl = String(body.pfp_url || body.pfpUrl || "").trim();

    const topic = String(body.topic || "").trim();
    const tone = mapTone(body.tone || "Funny");
    const scriptSeconds = mapDurationSeconds(body.length || body.duration || 60);

    const postVoiceId = String(body.postVoiceId || body.post_voice_id || "").trim();
    const scriptVoiceId = String(body.scriptVoiceId || body.script_voice_id || "").trim();

    const captionStyle = normCaptionStyle(body.captionStyle || "sentence");
    const captionSettings = body.captionSettings && typeof body.captionSettings === "object" ? body.captionSettings : {};

    const bg = body.background && typeof body.background === "object" ? body.background : {};
    const bgUrl = String(bg.url || "").trim();

    // ---- Validation ----
    if (!process.env.CREATOMATE_API_KEY) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!supabase) return res.status(500).json({ error: "MISSING_SUPABASE_ENV_VARS" });

    const template_id = String(process.env.CREATO_REDDIT_TEMPLATE_916 || "").trim();
    if (!template_id) return res.status(500).json({ error: "MISSING_CREATO_REDDIT_TEMPLATE_916" });

    if (!postText) return res.status(400).json({ error: "MISSING_POST_TEXT" });
    if (!topic) return res.status(400).json({ error: "MISSING_TOPIC" });
    if (!bgUrl) return res.status(400).json({ error: "MISSING_BACKGROUND_URL" });
    if (!postVoiceId) return res.status(400).json({ error: "MISSING_POST_VOICE_ID" });
    if (!scriptVoiceId) return res.status(400).json({ error: "MISSING_SCRIPT_VOICE_ID" });

    console.log("[REDDIT_VIDEO_REQUEST]", {
      requestId,
      memberId: String(memberId),
      theme,
      username,
      likeCount,
      commentCount,
      hasPfp: !!pfpUrl,
      topic,
      tone,
      scriptSeconds,
      captionStyle,
      hasBg: !!bgUrl,
    });

    // ---- DB insert ----
    const db_id = crypto.randomUUID();

    const choices = {
      kind: "reddit_video",
      theme,
      username,
      postText,
      likeCount,
      commentCount,
      pfpUrl: pfpUrl || null,
      topic,
      tone,
      scriptSeconds,
      postVoiceId,
      scriptVoiceId,
      background: { ...bg, url: bgUrl },
      captionStyle,
      captionSettings,
    };

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

    // ---- Generate script ----
    const scriptText = await generateScriptFromTopic({
      topic,
      tone,
      targetSeconds: scriptSeconds,
    });

    // ---- Generate audio (post + script) ----
    let postVoiceUrl = "";
    let scriptVoiceUrl = "";

    try {
      const postMp3 = await elevenlabsTTS({ voiceId: postVoiceId, text: postText });
      postVoiceUrl = await uploadVoiceMp3({
        path: `${db_id}/reddit/post.mp3`,
        mp3Buffer: postMp3,
      });
    } catch (e) {
      console.error("[POST_VOICE_FAILED]", { requestId, message: String(e?.message || e) });
      postVoiceUrl = "";
    }

    try {
      const scriptMp3 = await elevenlabsTTS({ voiceId: scriptVoiceId, text: scriptText });
      scriptVoiceUrl = await uploadVoiceMp3({
        path: `${db_id}/reddit/script.mp3`,
        mp3Buffer: scriptMp3,
      });
    } catch (e) {
      console.error("[SCRIPT_VOICE_FAILED]", { requestId, message: String(e?.message || e) });
      scriptVoiceUrl = "";
    }

    if (!postVoiceUrl) {
      await supabase.from("renders").update({ status: "failed", error: "POST_VOICE_FAILED" }).eq("id", db_id);
      return res.status(502).json({ error: "POST_VOICE_FAILED" });
    }
    if (!scriptVoiceUrl) {
      await supabase.from("renders").update({ status: "failed", error: "SCRIPT_VOICE_FAILED" }).eq("id", db_id);
      return res.status(502).json({ error: "SCRIPT_VOICE_FAILED" });
    }

    // ---- Timing ----
    const introSec = estimateIntroSeconds(postText);

    // ---- Creatomate mods ----
    const mods = {};

    // Background
    mods["bg_video.source"] = bgUrl;

    // Post data
    if (pfpUrl) mods["pfp.source"] = pfpUrl;
    mods["username.text"] = username;
    mods["post_text.text"] = postText;
    mods["like_count.text"] = likeCount;
    mods["comment_count.text"] = commentCount;

    // Theme toggle (you created 2 cards)
    mods["post_card_light.visible"] = theme === "light";
    mods["post_card_dark.visible"] = theme === "dark";

    // Post card intro only
    mods["post_card_light.start"] = 0;
    mods["post_card_light.duration"] = introSec;
    mods["post_card_dark.start"] = 0;
    mods["post_card_dark.duration"] = introSec;

    // Audio timing
    mods["post_voice.source"] = postVoiceUrl;
    mods["post_voice.start"] = 0;

    mods["script_voice.source"] = scriptVoiceUrl;
    mods["script_voice.start"] = introSec;

    // Captions (apply your chosen style/settings)
    Object.assign(mods, captionVisibilityMods(captionStyle));
    Object.assign(mods, captionSettingsMods(captionStyle, captionSettings));

    // IMPORTANT:
    // Your captions template must be set to transcribe from script_voice (or whatever audio layer you chose).
    // If your existing templates expect "Voiceover.source", you can ALSO duplicate script_voice in template
    // or rename script_voice to Voiceover. If you did name it Voiceover instead, uncomment:
    // mods["Voiceover.source"] = scriptVoiceUrl;
    // mods["Voiceover.start"] = introSec;

    const payload = {
      template_id,
      modifications: mods,
      output_format: "mp4",
      webhook_url: `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(db_id)}&kind=reddit`,
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
      requestId,
      introSec: Number(introSec.toFixed(2)),
      scriptSeconds,
      theme,
      captionStyle,
      postVoiceUrl,
      scriptVoiceUrl,
      scriptTextPreview: scriptText.slice(0, 220),
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: msg });
    }
    console.error("[REDDIT_VIDEO] SERVER_ERROR", { requestId, err });
    return res.status(500).json({ error: "SERVER_ERROR", message: msg, requestId });
  }
};
