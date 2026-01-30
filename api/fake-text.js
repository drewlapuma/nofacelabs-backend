// api/fake-text.js (CommonJS, Node 18+)

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

// ---------- ElevenLabs (copied from your create-video.js) ----------
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

// Upload MP3 -> return a URL Creatomate can fetch
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
    .createSignedUrl(path, 60 * 60);

  if (signErr || !signed?.signedUrl) {
    console.error("[VOICE_SIGNED_URL_FAILED]", signErr);
    return publicUrl;
  }

  return signed.signedUrl;
}

// ---------- Chat layout presets ----------
const CHAT_PRESETS = {
  iphone: {
    template_id: (process.env.CREATO_CHAT_TEMPLATE_IPHONE || "").trim(),
    chatTop: 320,
    chatBottom: 980,
    charsPerLine: 22,
    lineHeight: 44,
    bubblePad: 44,
    imageBubbleHeight: 260,
    gapY: 18,
  },
  instagram: {
    template_id: (process.env.CREATO_CHAT_TEMPLATE_INSTAGRAM || "").trim(),
    chatTop: 320,
    chatBottom: 980,
    charsPerLine: 24,
    lineHeight: 44,
    bubblePad: 44,
    imageBubbleHeight: 260,
    gapY: 18,
  },
  whatsapp: {
    template_id: (process.env.CREATO_CHAT_TEMPLATE_WHATSAPP || "").trim(),
    chatTop: 320,
    chatBottom: 980,
    charsPerLine: 26,
    lineHeight: 42,
    bubblePad: 42,
    imageBubbleHeight: 260,
    gapY: 16,
  },
};

function countWords(text) {
  return (String(text || "").match(/\S+/g) || []).length;
}

// Duration estimate (good pacing)
function estimateLineSeconds(text) {
  const words = countWords(text);
  // ~2.7 words/sec + tiny padding
  return Math.max(0.45, words / 2.7 + 0.12);
}

function estimateBubbleHeight(msg, preset) {
  if (msg.type === "image") return preset.imageBubbleHeight;
  const text = String(msg.text || "");
  const lines = Math.max(1, Math.ceil(text.length / preset.charsPerLine));
  return preset.bubblePad + lines * preset.lineHeight;
}

// ---------- MAIN ----------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const requestId = crypto.randomUUID();

  try {
    const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
    const memberId = await requireMemberId(req);

    if (!process.env.CREATOMATE_API_KEY) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!supabase) return res.status(500).json({ error: "MISSING_SUPABASE_ENV_VARS" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    const templateKey = String(body.template || "iphone").toLowerCase();
    const preset = CHAT_PRESETS[templateKey];
    if (!preset || !preset.template_id) {
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_CHAT", template: templateKey });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: "NO_MESSAGES" });

    const maxDuration = Math.min(Number(body.options?.maxDurationSeconds || 90), 90);

    // Create DB render row (reuse your renders table if you want)
    const db_id = crypto.randomUUID();

    const { error: preInsErr } = await supabase.from("renders").insert([
      {
        id: db_id,
        member_id: String(memberId),
        status: "waiting",
        video_url: null,
        render_id: "pending",
        choices: {
          kind: "fake_text",
          template: templateKey,
          receiver: body.receiver || {},
          background: body.background || {},
          voices: body.voices || {},
          messageCount: messages.length,
          maxDuration,
        },
        error: null,
      },
    ]);

    if (preInsErr) {
      console.error("[DB_PREINSERT_FAILED]", { requestId, error: preInsErr });
      return res.status(500).json({ error: "DB_PREINSERT_FAILED", details: preInsErr });
    }

    // ---------- Build Creatomate modifications ----------
    const mods = {};

    // Header/background
    mods["hdr_name"] = String(body.receiver?.name || "Unknown");
    mods["hdr_avatar.source"] = String(body.receiver?.avatarUrl || "");
    mods["bg_video.source"] = String(body.background?.url || "");

    // Clear all slots first (assume 60 slots in template)
    const MAX_SLOTS = 60;
    for (let i = 1; i <= MAX_SLOTS; i++) {
      mods[`Msg${i}_Group.start`] = 0;
      mods[`Msg${i}_Group.duration`] = 0;
      mods[`Msg${i}_Group.y`] = preset.chatTop;

      mods[`Msg${i}_Me_Text.visible`] = false;
      mods[`Msg${i}_Them_Text.visible`] = false;
      mods[`Msg${i}_Me_Image.visible`] = false;
      mods[`Msg${i}_Them_Image.visible`] = false;

      mods[`Msg${i}_Me_Text.text`] = "";
      mods[`Msg${i}_Them_Text.text`] = "";
      mods[`Msg${i}_Me_Image.source`] = "";
      mods[`Msg${i}_Them_Image.source`] = "";

      mods[`Msg${i}_Audio.start`] = 0;
      mods[`Msg${i}_Audio.duration`] = 0;
      mods[`Msg${i}_Audio.source`] = "";
    }

    // Track page + layout
    let t = 0;
    let currentY = preset.chatTop;

    // Track which slots are on the current “page” so we can hard-cut them
    let pageSlotIndices = [];
    let pageStartTime = 0;

    function hardCutReset(resetTime) {
      for (const idx of pageSlotIndices) {
        const start = Number(mods[`Msg${idx}_Group.start`] || 0);
        const dur = Math.max(0, resetTime - start);
        mods[`Msg${idx}_Group.duration`] = dur;
        // Audio duration also ends at reset
        const astart = Number(mods[`Msg${idx}_Audio.start`] || start);
        const adur = Math.max(0, resetTime - astart);
        mods[`Msg${idx}_Audio.duration`] = adur;
      }
      pageSlotIndices = [];
      currentY = preset.chatTop;
      pageStartTime = resetTime;
    }

    let slot = 1;

    for (let i = 0; i < messages.length; i++) {
      if (t >= maxDuration) break;
      if (slot > MAX_SLOTS) break; // if you hit this, increase MAX_SLOTS in template + here.

      const msg = messages[i] || {};
      const sender = msg.sender === "them" ? "them" : "me";
      const type = msg.type === "image" ? "image" : "text";

      const bubbleH = estimateBubbleHeight(msg, preset);

      // If overflow -> hard reset now (hard cut)
      if (currentY + bubbleH > preset.chatBottom) {
        hardCutReset(t);
      }

      // Choose voice + spoken line
      const voiceId = sender === "me" ? body.voices?.me?.voiceId : body.voices?.them?.voiceId;
      if (!voiceId) {
        return res.status(400).json({ error: "MISSING_VOICE_ID", which: sender });
      }

      let spoken = "";
      if (type === "text") spoken = String(msg.text || "").trim();
      else spoken = "Sent a photo."; // image-only, no caption, short read

      // Generate + upload audio for this message
      const mp3 = await elevenlabsTTS({ voiceId, text: spoken });
      const audioPath = `${db_id}/chat/audio_${String(slot).padStart(4, "0")}.mp3`;
      const audioUrl = await uploadVoiceMp3({ path: audioPath, mp3Buffer: mp3 });

      const dur = estimateLineSeconds(spoken);
      const gap = 0.12;

      // Place the slot group
      mods[`Msg${slot}_Group.start`] = t;
      // duration is set later (either reset time or end of video)
      mods[`Msg${slot}_Group.y`] = currentY;

      // Toggle correct bubble
      if (sender === "me" && type === "text") {
        mods[`Msg${slot}_Me_Text.visible`] = true;
        mods[`Msg${slot}_Me_Text.text`] = String(msg.text || "");
      } else if (sender === "them" && type === "text") {
        mods[`Msg${slot}_Them_Text.visible`] = true;
        mods[`Msg${slot}_Them_Text.text`] = String(msg.text || "");
      } else if (sender === "me" && type === "image") {
        mods[`Msg${slot}_Me_Image.visible`] = true;
        mods[`Msg${slot}_Me_Image.source`] = String(msg.imageUrl || "");
      } else {
        mods[`Msg${slot}_Them_Image.visible`] = true;
        mods[`Msg${slot}_Them_Image.source`] = String(msg.imageUrl || "");
      }

      // Audio
      mods[`Msg${slot}_Audio.start`] = t;
      mods[`Msg${slot}_Audio.source`] = audioUrl;

      // Track this slot as part of current page
      pageSlotIndices.push(slot);

      // Advance
      currentY += bubbleH + preset.gapY;
      t += Math.max(0.45, dur) + gap;
      slot++;
    }

    // End remaining page at end time (hard cut at end)
    hardCutReset(Math.min(t, maxDuration));

    // ---------- Creatomate render ----------
    const payload = {
      template_id: preset.template_id,
      modifications: mods,
      output_format: "mp4",
      webhook_url: `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(db_id)}&kind=fake_text`,
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

    return res.status(200).json({
      ok: true,
      job_id,
      db_id,
      requestId,
      template: templateKey,
      placedMessages: slot - 1,
      maxDuration,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: msg });
    }
    console.error("[FAKE_TEXT] SERVER_ERROR", { requestId, err });
    return res.status(500).json({ error: "SERVER_ERROR", message: msg, requestId });
  }
};
