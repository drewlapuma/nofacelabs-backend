// api/create-video.js (CommonJS, Node 18)

const https = require("https");
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

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const publicBaseUrl = API_BASE || `https://${req.headers.host}`;

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

    // OPTIONAL: if you have a dedicated audio-only template (recommended)
    // Create it in Creatomate with just a Voiceover element, no visuals.
    const audioTemplateId =
      (process.env.CREATO_AUDIO_TEMPLATE || "").trim() || template_id;

    const choices = { storyType, artStyle, language, voice, aspectRatio, customPrompt, durationRange };

    // 1) Create DB row first
    const { data: row, error: insErr } = await supabase
      .from("renders")
      .insert([
        {
          member_id: String(memberId),
          status: "rendering",
          video_url: null,
          render_id: "",
          choices,
          error: null,

          // captions fields (optional defaults)
          caption_status: "not_started",
          caption_error: null,
          caption_template_id: "minimal",
          captioned_video_url: null,
        },
      ])
      .select("id")
      .single();

    if (insErr) return res.status(500).json({ error: "DB_INSERT_FAILED", details: insErr });
    const db_id = row.id;

    // 2) Generate script
    const scriptResp = await fetch(`${publicBaseUrl}/api/generate-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyType, artStyle, language, customPrompt, durationRange }),
    }).then((r) => r.json());

    const narration = (scriptResp && scriptResp.narration) || "";
    if (!narration.trim()) {
      await supabase.from("renders").update({ status: "failed", error: "SCRIPT_EMPTY" }).eq("id", db_id);
      return res.status(502).json({ error: "SCRIPT_EMPTY", details: scriptResp });
    }

    // 3) Build your existing mods
    const mods = {
      Narration: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      Voiceover: narration,
      VoiceUrl: null,
      "Captions_JSON.text": "", // still fine
    };

    // NOTE: keep all your beat timing + image assignment code here
    // (I’m not changing it — paste your existing beat/image loops back in)
    // --------------------
    // YOUR EXISTING timing + krea image loops go here
    // --------------------

    // 4) Start VIDEO render (mp4)
    const videoWebhook = `${publicBaseUrl}/api/creatomate-webhook?db_id=${encodeURIComponent(
      db_id
    )}&kind=video`;

    const videoPayload = {
      template_id,
      modifications: mods,
      output_format: "mp4",
      webhook_url: videoWebhook,
    };

    const videoResp = await postJSON(
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      videoPayload
    );

    if (videoResp.status !== 202 && videoResp.status !== 200) {
      await supabase.from("renders").update({ status: "failed", error: JSON.stringify(videoResp.json) }).eq("id", db_id);
      return res.status(videoResp.status).json({ error: "CREATOMATE_VIDEO_ERROR", details: videoResp.json });
    }

    const videoJobId = Array.isArray(videoResp.json) ? videoResp.json[0]?.id : videoResp.json?.id;
    if (!videoJobId) {
      await supabase.from("renders").update({ status: "failed", error: "NO_VIDEO_JOB_ID" }).eq("id", db_id);
      return res.status(502).json({ error: "NO_VIDEO_JOB_ID_IN_RESPONSE", details: videoResp.json });
    }

    await supabase.from("renders").update({ render_id: String(videoJobId) }).eq("id", db_id);

    // 5) Start AUDIO render (mp3) — THIS IS THE IMPORTANT NEW PART
    const audioWebhook = `${publicBaseUrl}/api/creatomate-webhook?db_id=${encodeURIComponent(
      db_id
    )}&kind=audio`;

    const audioPayload = {
      template_id: audioTemplateId,
      modifications: mods,
      output_format: "mp3",
      webhook_url: audioWebhook,
    };

    const audioResp = await postJSON(
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      audioPayload
    );

    let audioJobId = null;
    if (audioResp.status === 202 || audioResp.status === 200) {
      audioJobId = Array.isArray(audioResp.json) ? audioResp.json[0]?.id : audioResp.json?.id;
    } else {
      // don’t fail the whole video if audio fails — but log it
      console.error("[CREATOMATE_AUDIO_ERROR]", audioResp.status, audioResp.json);
    }

    if (audioJobId) {
      // store on the row without adding new columns (keeps your schema unchanged)
      const nextChoices = { ...(choices || {}), audio_render_id: String(audioJobId) };
      await supabase.from("renders").update({ choices: nextChoices }).eq("id", db_id);
    }

    return res.status(200).json({
      ok: true,
      db_id,
      video_job_id: String(videoJobId),
      audio_job_id: audioJobId ? String(audioJobId) : null,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: msg });
    }
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: msg });
  }
};
