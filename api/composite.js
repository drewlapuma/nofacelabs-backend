// api/composite.js (CommonJS, Node 18+ on Vercel)
//
// POST /api/composite
// body: {
//   mainPath,
//   backgroundPath OR backgroundVideoUrl,
//   layout: "sideBySide" | "topBottom",
//   mainSpeed, bgSpeed, bgMuted,
//   captions: { enabled, style, settings }
// }
//
// GET /api/composite?id=RENDER_ID
// GET /api/composite?id=RENDER_ID&raw=1   -> returns full Creatomate object for debugging

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

// -------------------- CORS --------------------
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  // If "*" then do NOT set credentials.
  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // Only set credentials when you are NOT using "*"
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return "__INVALID__";
  }
}

// -------------------- Supabase helpers --------------------
function getSupabaseAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function signedReadUrl(bucket, path, expiresIn = 3600) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Signed read URL error: ${error?.message || "Object not found"}`);
  }
  return data.signedUrl;
}

// -------------------- Creatomate helper --------------------
function creatomateRequest(method, path, bodyObj) {
  const apiKey = process.env.CREATOMATE_API_KEY;
  if (!apiKey) throw new Error("Missing CREATOMATE_API_KEY env var");

  const body = bodyObj ? JSON.stringify(bodyObj) : null;

  const opts = {
    method,
    hostname: "api.creatomate.com",
    path,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };

  return new Promise((resolve, reject) => {
    const rq = https.request(opts, (rs) => {
      let data = "";
      rs.on("data", (d) => (data += d));
      rs.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data || "{}");
        } catch {
          parsed = { raw: data };
        }

        if (rs.statusCode < 200 || rs.statusCode >= 300) {
          const msg =
            parsed?.error ||
            parsed?.message ||
            parsed?.hint ||
            parsed?.raw ||
            `Creatomate HTTP ${rs.statusCode}`;
          const err = new Error(msg);
          err.statusCode = rs.statusCode;
          err.details = parsed;
          return reject(err);
        }

        resolve(parsed);
      });
    });

    rq.on("error", reject);
    if (body) rq.write(body);
    rq.end();
  });
}

// -------------------- Captions effect normalization --------------------
function normalizeTranscriptEffect(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;

  if (["highlighter", "yellowpop", "minttag", "purplepop", "redtag"].includes(s)) return "highlight";

  const allowed = new Set(["color", "karaoke", "highlight", "fade", "bounce", "slide", "enlarge"]);
  return allowed.has(s) ? s : null;
}

// -------------------- Build modifications --------------------
function buildModifications({ mainUrl, bgUrl, payload }) {
  const GROUP_SIDE = process.env.COMPOSITE_GROUP_SIDE || "Layout_SideBySide";
  const GROUP_TB = process.env.COMPOSITE_GROUP_TOPBOTTOM || "Layout_TopBottom";

  const MAIN_SIDE = process.env.COMPOSITE_MAIN_LAYER_SIDE || "input_video_visual_side";
  const BG_SIDE   = process.env.COMPOSITE_BG_LAYER_SIDE   || "bg-video_side";
  const MAIN_TB   = process.env.COMPOSITE_MAIN_LAYER_TB   || "input_video_visual_tb";
  const BG_TB     = process.env.COMPOSITE_BG_LAYER_TB     || "bg-video_tb";

  // audio/transcription feeder at root
  const MAIN_AUDIO = process.env.COMPOSITE_MAIN_AUDIO_LAYER || "input_video";

  const SUBTITLE_LAYERS = [
    "Subtitles_Sentence",
    "Subtitles_Word",
    "Subtitles_Karaoke",
    "Subtitles_BoldWhite",
    "Subtitles_YellowPop",
    "Subtitles_MintTag",
    "Subtitles_OutlinePunch",
    "Subtitles_BlackBar",
    "Subtitles_Highlighter",
    "Subtitles_NeonGlow",
    "Subtitles_PurplePop",
    "Subtitles_CompactLowerThird",
    "Subtitles_BouncePop",
    "Subtitles_RedAlert",
    "Subtitles_RedTag",
  ];

  const layout = payload.layout === "topBottom" ? "topBottom" : "sideBySide";
  const mainSpeed = Number(payload.mainSpeed || 1);
  const bgSpeed = Number(payload.bgSpeed || 1);
  const bgMuted = payload.bgMuted !== false;

  const cap = payload.captions || {};
  const capEnabled = cap.enabled !== false;
  const settings = cap.settings || {};

  const styleRaw = String(cap.style || "").trim();
  const pickedSubtitleLayer = SUBTITLE_LAYERS.includes(styleRaw) ? styleRaw : "Subtitles_Sentence";

  const effectRaw =
    settings.transcript_effect ??
    settings.transcriptEffect ??
    settings.active_effect ??
    settings.activeEffect ??
    settings.effect ??
    styleRaw;

  const transcript_effect = normalizeTranscriptEffect(effectRaw) || "color";

  const transcriptColor =
    settings.transcript_color ??
    settings.transcriptColor ??
    settings.activeColor ??
    settings.active_color;

  const mods = {};

  // Show only the selected layout group
  mods[GROUP_SIDE] = { visible: layout === "sideBySide" };
  mods[GROUP_TB] = { visible: layout === "topBottom" };

  // ✅ IMPORTANT: set provider:url + source on every video layer
  // Main visible videos: show picture, but mute audio (audio comes from MAIN_AUDIO)
  mods[MAIN_SIDE] = {
    provider: "url",
    source: mainUrl,
    playback_rate: mainSpeed,
    visible: true,
    opacity: "100%",
    volume: "0%",
  };
  mods[MAIN_TB] = {
    provider: "url",
    source: mainUrl,
    playback_rate: mainSpeed,
    visible: true,
    opacity: "100%",
    volume: "0%",
  };

  // Background videos: muted
  mods[BG_SIDE] = {
    provider: "url",
    source: bgUrl,
    playback_rate: bgSpeed,
    visible: true,
    opacity: "100%",
    volume: bgMuted ? "0%" : "100%",
  };
  mods[BG_TB] = {
    provider: "url",
    source: bgUrl,
    playback_rate: bgSpeed,
    visible: true,
    opacity: "100%",
    volume: bgMuted ? "0%" : "100%",
  };

  // Audio/transcription feeder: invisible but audio ON
  mods[MAIN_AUDIO] = {
    provider: "url",
    source: mainUrl,
    playback_rate: mainSpeed,
    visible: true,
    opacity: "0%",
    volume: "100%",
  };

  // Captions: disable all, enable one
  for (const name of SUBTITLE_LAYERS) mods[name] = { visible: false };

  mods[pickedSubtitleLayer] = {
    visible: !!capEnabled,
    transcript_effect,
    ...(transcriptColor ? { transcript_color: String(transcriptColor) } : {}),
  };

  return mods;
}

// -------------------- Handler --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const BUCKET =
      process.env.SUPABASE_UPLOAD_BUCKET ||
      process.env.USER_VIDEOS_BUCKET ||
      "user-uploads";

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json(res, 400, { ok: false, error: "Missing body" });
      if (body === "__INVALID__") return json(res, 400, { ok: false, error: "Invalid JSON" });

      const templateId = process.env.COMPOSITE_TEMPLATE_ID;
      if (!templateId) return json(res, 500, { ok: false, error: "Missing COMPOSITE_TEMPLATE_ID env var" });

      const mainPath = body.mainPath;
      const backgroundPath = body.backgroundPath;
      const backgroundVideoUrl = body.backgroundVideoUrl;

      if (!mainPath) return json(res, 400, { ok: false, error: "mainPath is required" });
      if (!backgroundPath && !backgroundVideoUrl) {
        return json(res, 400, { ok: false, error: "backgroundPath or backgroundVideoUrl is required" });
      }

      const mainUrl = await signedReadUrl(BUCKET, mainPath, 60 * 60);
      const bgUrl = backgroundVideoUrl
        ? String(backgroundVideoUrl)
        : await signedReadUrl(BUCKET, backgroundPath, 60 * 60);

      const modifications = buildModifications({ mainUrl, bgUrl, payload: body });

      const created = await creatomateRequest("POST", "/v1/renders", {
        template_id: templateId,
        modifications,
        output_format: "mp4",
      });

      const item = Array.isArray(created) ? created[0] : created;
      const renderId = item?.id;
      const status = item?.status || "planned";

      if (!renderId) {
        return json(res, 500, {
          ok: false,
          error: "Creatomate response missing id",
          details: created,
        });
      }

      return json(res, 200, { ok: true, renderId, status });
    }

    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest("GET", `/v1/renders/${encodeURIComponent(id)}`, null);

      // Debug: return raw object so you can see warnings/errors
      if (String(req.query?.raw || "") === "1") {
        return json(res, 200, { ok: true, render: r });
      }

      const status = String(r?.status || "").toLowerCase();
      const url = r?.url || r?.output_url || null;

      if (status === "failed") {
        return json(res, 200, {
          ok: true,
          status: "failed",
          error: r?.error || r?.message || "Render failed",
          warnings: r?.warnings || null,
        });
      }

      if (status === "succeeded" && url) {
        return json(res, 200, {
          ok: true,
          status: "succeeded",
          url,
          warnings: r?.warnings || null,
        });
      }

      return json(res, 200, { ok: true, status: r?.status || "processing" });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err?.message || String(err),
      statusCode: err?.statusCode || null,
      details: err?.details || null,
    });
  }
};
