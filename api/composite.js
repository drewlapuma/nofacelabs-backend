// api/composite.js (CommonJS, Node 18+ on Vercel)

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
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

function buildModifications({ mainUrl, bgUrl, payload }) {
  // ---- layout groups
  const GROUP_SIDE = process.env.COMPOSITE_GROUP_SIDE || "Layout_SideBySide";
  const GROUP_TB   = process.env.COMPOSITE_GROUP_TOPBOTTOM || "Layout_TopBottom";

  // ---- slot groups (your exact names)
  const SIDE_LEFT_GROUP  = process.env.COMPOSITE_SIDE_LEFT_GROUP  || "Main_Left";
  const SIDE_RIGHT_GROUP = process.env.COMPOSITE_SIDE_RIGHT_GROUP || "Main_Right";
  const TB_TOP_GROUP     = process.env.COMPOSITE_TB_TOP_GROUP     || "Main_Top";
  const TB_BOTTOM_GROUP  = process.env.COMPOSITE_TB_BOTTOM_GROUP  || "Main_Bottom";

  // ---- main visual layers (your exact names)
  const MAIN_SIDE_LEFT   = process.env.COMPOSITE_MAIN_SIDE_LEFT   || "input_video_visual_side_left";
  const MAIN_SIDE_RIGHT  = process.env.COMPOSITE_MAIN_SIDE_RIGHT  || "input_video_visual_side_right";
  const MAIN_TB_TOP      = process.env.COMPOSITE_MAIN_TB_TOP      || "input_video_visual_tb_top";
  const MAIN_TB_BOTTOM   = process.env.COMPOSITE_MAIN_TB_BOTTOM   || "input_video_visual_tb_bottom";

  // ---- background visual layers (IMPORTANT: hyphens, matches your template)
  const BG_SIDE_LEFT     = process.env.COMPOSITE_BG_SIDE_LEFT     || "bg-video_side_left";
  const BG_SIDE_RIGHT    = process.env.COMPOSITE_BG_SIDE_RIGHT    || "bg-video_side_right";
  const BG_TB_TOP        = process.env.COMPOSITE_BG_TB_TOP        || "bg-video_tb_top";
  const BG_TB_BOTTOM     = process.env.COMPOSITE_BG_TB_BOTTOM     || "bg-video_tb_bottom";

  // ---- audio/transcription feeder (root)
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

  // mainSlot: sideBySide => left/right, topBottom => top/bottom
  const mainSlotRaw = String(payload.mainSlot || payload.main_slot || "left").toLowerCase();
  const mainSlot = ["left","right","top","bottom"].includes(mainSlotRaw) ? mainSlotRaw : "left";

  const mainSpeed = Number(payload.mainSpeed || payload.main_speed || 1);
  const bgSpeed   = Number(payload.bgSpeed || payload.bg_speed || 1);

  // If you want bg always muted, keep default true
  const bgMuted = (payload.bgMuted ?? payload.bg_muted) !== false;

  // captions selection
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

  // ---- layout visibility
  mods[GROUP_SIDE] = { visible: layout === "sideBySide" };
  mods[GROUP_TB]   = { visible: layout === "topBottom" };

  // ✅ For split layouts, BOTH halves must be visible
  mods[SIDE_LEFT_GROUP]  = { visible: layout === "sideBySide" };
  mods[SIDE_RIGHT_GROUP] = { visible: layout === "sideBySide" };
  mods[TB_TOP_GROUP]     = { visible: layout === "topBottom" };
  mods[TB_BOTTOM_GROUP]  = { visible: layout === "topBottom" };

  // Helper to set a slot to show MAIN or show BG (and hide the other layer)
  function setSlot({ mainLayer, bgLayer, showMain }) {
    mods[mainLayer] = {
      source: mainUrl,
      playback_rate: mainSpeed,
      visible: true,
      opacity: showMain ? 1 : 0,
      volume: showMain ? 1 : 0, // visual layers can carry audio, but we’ll manage feeder too
    };

    mods[bgLayer] = {
      source: bgUrl,
      playback_rate: bgSpeed,
      visible: true,
      opacity: showMain ? 0 : 1,
      volume: showMain ? 0 : (bgMuted ? 0 : 1),
    };
  }

  // ---- SIDE BY SIDE mapping
  if (layout === "sideBySide") {
    setSlot({ mainLayer: MAIN_SIDE_LEFT,  bgLayer: BG_SIDE_LEFT,  showMain: mainSlot === "left" });
    setSlot({ mainLayer: MAIN_SIDE_RIGHT, bgLayer: BG_SIDE_RIGHT, showMain: mainSlot === "right" });
  } else {
    // still set them (safe), but hidden by group visibility
    setSlot({ mainLayer: MAIN_SIDE_LEFT,  bgLayer: BG_SIDE_LEFT,  showMain: true });
    setSlot({ mainLayer: MAIN_SIDE_RIGHT, bgLayer: BG_SIDE_RIGHT, showMain: false });
  }

  // ---- TOP / BOTTOM mapping
  if (layout === "topBottom") {
    setSlot({ mainLayer: MAIN_TB_TOP,    bgLayer: BG_TB_TOP,    showMain: mainSlot === "top" });
    setSlot({ mainLayer: MAIN_TB_BOTTOM, bgLayer: BG_TB_BOTTOM, showMain: mainSlot === "bottom" });
  } else {
    // safe defaults
    setSlot({ mainLayer: MAIN_TB_TOP,    bgLayer: BG_TB_TOP,    showMain: true });
    setSlot({ mainLayer: MAIN_TB_BOTTOM, bgLayer: BG_TB_BOTTOM, showMain: false });
  }

  // ---- feeder for captions (keep muted to avoid double audio)
  mods[MAIN_AUDIO] = {
    source: mainUrl,
    playback_rate: mainSpeed,
    visible: true,
    opacity: 0,
    volume: 0,
  };

  // ---- captions: all off, one on
  for (const name of SUBTITLE_LAYERS) mods[name] = { visible: false };

  mods[pickedSubtitleLayer] = {
    visible: !!capEnabled,
    transcript_effect,
    ...(transcriptColor ? { transcript_color: String(transcriptColor) } : {}),
    transcript_source: MAIN_AUDIO,
  };

  return mods;
}


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

      if (!renderId) return json(res, 500, { ok: false, error: "Creatomate response missing id", details: created });

      return json(res, 200, { ok: true, renderId, status });
    }

    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest("GET", `/v1/renders/${encodeURIComponent(id)}`, null);
      const status = String(r?.status || "").toLowerCase();
      const url = r?.url || r?.output_url || null;

      if (status === "failed") {
        return json(res, 200, { ok: true, status: "failed", error: r?.error || r?.message || "Render failed" });
      }
      if (status === "succeeded" && url) {
        return json(res, 200, { ok: true, status: "succeeded", url });
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
