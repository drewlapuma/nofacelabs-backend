// api/composite.js (CommonJS, Node 18+ on Vercel)

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

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

// -------------------- Creatomate helpers --------------------
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
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data || "null");
        } catch {
          parsed = null;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(
            `Creatomate HTTP ${res.statusCode}: ${parsed?.error || parsed?.message || data || "Unknown error"}`
          );
          err.statusCode = res.statusCode;
          err.creatomate = parsed || data;
          err.requestBody = bodyObj || null;
          err.requestPath = path;
          return reject(err);
        }

        resolve(parsed ?? {});
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}


// Creatomate transcript effect must be one of:
// color, karaoke, highlight, fade, bounce, slide, enlarge
function normalizeTranscriptEffect(v) {
  const s = String(v || "").trim().toLowerCase();

  // UI aliases
  if (s === "highlighter" || s === "highlighted") return "highlight";
  if (s === "yellowpop" || s === "minttag" || s === "purplepop" || s === "redtag")
    return "highlight";

  const allowed = new Set([
    "color",
    "karaoke",
    "highlight",
    "fade",
    "bounce",
    "slide",
    "enlarge",
  ]);

  if (allowed.has(s)) return s;

  // If they pass a caption style name, map it to a safe default
  if (!s) return "color";
  if (s.includes("karaoke")) return "karaoke";
  if (s.includes("bounce")) return "bounce";
  if (s.includes("slide")) return "slide";
  if (s.includes("fade")) return "fade";
  if (s.includes("highlight")) return "highlight";
  if (s.includes("enlarge")) return "enlarge";

  return "color";
}

function normalizeHex(c) {
  if (!c) return null;
  const s = String(c).trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return (
      "#" +
      s[1] + s[1] +
      s[2] + s[2] +
      s[3] + s[3]
    ).toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return null;
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
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Signed read URL error: ${error?.message || "Object not found"}`);
  }
  return data.signedUrl;
}

// -------------------- Caption layer mapping (YOUR TEMPLATE NAMES) --------------------
const ALL_SUBTITLE_LAYERS = [
  "Subtitles_RedTag",
  "Subtitles_RedAlert",
  "Subtitles_BouncePop",
  "Subtitles_CompactLowerThird",
  "Subtitles_PurplePop",
  "Subtitles_NeonGlow",
  "Subtitles_Highlighter",
  "Subtitles_BlackBar",
  "Subtitles_OutlinePunch",
  "Subtitles_MintTag",
  "Subtitles_YellowPop",
  "Subtitles_BoldWhite",
  "Subtitles_Karaoke",
  "Subtitles_Sentence",
  "Subtitles_Word",
];

function mapCaptionLayer(style) {
  const s = String(style || "").toLowerCase();

  if (s.includes("sentence")) return "Subtitles_Sentence";
  if (s.includes("word")) return "Subtitles_Word";
  if (s.includes("karaoke")) return "Subtitles_Karaoke";
  if (s.includes("boldwhite") || s.includes("bold white")) return "Subtitles_BoldWhite";
  if (s.includes("yellow")) return "Subtitles_YellowPop";
  if (s.includes("mint")) return "Subtitles_MintTag";
  if (s.includes("blackbar") || s.includes("black bar")) return "Subtitles_BlackBar";
  if (s.includes("highlighter")) return "Subtitles_Highlighter";
  if (s.includes("neon")) return "Subtitles_NeonGlow";
  if (s.includes("purple")) return "Subtitles_PurplePop";
  if (s.includes("lower")) return "Subtitles_CompactLowerThird";
  if (s.includes("bounce")) return "Subtitles_BouncePop";
  if (s.includes("outline")) return "Subtitles_OutlinePunch";
  if (s.includes("redalert") || s.includes("red alert")) return "Subtitles_RedAlert";
  if (s.includes("red")) return "Subtitles_RedTag";

  return "Subtitles_Sentence";
}

// -------------------- Build Creatomate modifications (FIXED SHAPE) --------------------
function buildModifications({ mainUrl, bgUrl, payload }) {
  // Default to your actual layer names
  const MAIN = process.env.COMPOSITE_MAIN_LAYER || "input_video";
  const BG = process.env.COMPOSITE_BG_LAYER || "bg-video";

  const layout = payload.layout === "topBottom" ? "topBottom" : "sideBySide";
  const mainSlot = String(payload.mainSlot || (layout === "topBottom" ? "top" : "left"));

  const mainSpeed = Number(payload.mainSpeed || 1);
  const bgSpeed = Number(payload.bgSpeed || 1);

  // Default true (muted) unless explicitly false
  const bgMuted = payload.bgMuted === false ? false : true;

  const cap = payload.captions || {};
  const capEnabled = cap.enabled !== false;
  const captionStyle = cap.style || "sentence";
  const settings = cap.settings || {};

  const effectRaw =
    settings.transcript_effect ??
    settings.transcriptEffect ??
    settings.active_effect ??
    settings.activeEffect ??
    settings.effect ??
    settings.highlightStyle ??
    captionStyle;

  const transcript_effect = normalizeTranscriptEffect(effectRaw);

  const transcriptColor =
    settings.transcript_color ??
    settings.transcriptColor ??
    settings.activeColor ??
    settings.active_color;

  const transcript_color = normalizeHex(transcriptColor);

  const activeSubtitleLayer = mapCaptionLayer(captionStyle);

  const mods = [];

  // Video sources (correct key is "source")
  mods.push({ name: MAIN, properties: { source: mainUrl } });
  mods.push({ name: BG, properties: { source: bgUrl } });

  // Speeds
  mods.push({ name: MAIN, properties: { playback_rate: mainSpeed } });
  mods.push({ name: BG, properties: { playback_rate: bgSpeed } });

  // Mute bg
  if (bgMuted) mods.push({ name: BG, properties: { volume: 0 } });

  // Layout toggles (only if you created these groups in the template)
  const GROUP_SIDE = process.env.COMPOSITE_GROUP_SIDE || "Layout_SideBySide";
  const GROUP_TB = process.env.COMPOSITE_GROUP_TOPBOTTOM || "Layout_TopBottom";
  mods.push({ name: GROUP_SIDE, properties: { visible: layout === "sideBySide" } });
  mods.push({ name: GROUP_TB, properties: { visible: layout === "topBottom" } });

  // Slot toggles (only if you created these groups in the template)
  mods.push({ name: "Main_Left", properties: { visible: mainSlot === "left" } });
  mods.push({ name: "Main_Right", properties: { visible: mainSlot === "right" } });
  mods.push({ name: "Main_Top", properties: { visible: mainSlot === "top" } });
  mods.push({ name: "Main_Bottom", properties: { visible: mainSlot === "bottom" } });

  // Captions: hide all, show only active
  for (const layer of ALL_SUBTITLE_LAYERS) {
    mods.push({ name: layer, properties: { visible: false } });
  }

  if (capEnabled) {
    mods.push({ name: activeSubtitleLayer, properties: { visible: true } });

    // IMPORTANT: transcript_effect must be valid or render fails
    mods.push({ name: activeSubtitleLayer, properties: { transcript_effect } });

    if (transcript_color) {
      mods.push({ name: activeSubtitleLayer, properties: { transcript_color } });
    }
  }

  return mods;
}

// -------------------- Handler --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  try {
    const BUCKET =
      process.env.SUPABASE_UPLOAD_BUCKET ||
      process.env.USER_VIDEOS_BUCKET ||
      "user-uploads";

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json(res, 400, { ok: false, error: "Missing body" });
      if (body === "__INVALID__") return json(res, 400, { ok: false, error: "Invalid JSON" });

      const templateId =
        process.env.COMPOSITE_TEMPLATE_ID ||
        process.env.CREATOMATE_TEMPLATE_ID ||
        "";

      if (!templateId) {
        return json(res, 500, { ok: false, error: "Missing COMPOSITE_TEMPLATE_ID env var" });
      }

      const mainPath = body.mainPath;
      const backgroundPath = body.backgroundPath;
      const backgroundVideoUrl = body.backgroundVideoUrl;

      if (!mainPath) return json(res, 400, { ok: false, error: "mainPath is required" });
      if (!backgroundPath && !backgroundVideoUrl) {
        return json(res, 400, { ok: false, error: "backgroundPath or backgroundVideoUrl is required" });
      }

      // Signed source URLs
      const mainUrl = await signedReadUrl(BUCKET, mainPath, 60 * 60);
      const bgUrl = backgroundVideoUrl
        ? String(backgroundVideoUrl)
        : await signedReadUrl(BUCKET, backgroundPath, 60 * 60);

      const modifications = buildModifications({ mainUrl, bgUrl, payload: body });

      // Create render
      const createPayload = {
        template_id: templateId,
        modifications,
        output_format: "mp4",
      };

      const created = await creatomateRequest("POST", "/v1/renders", createPayload);

      // POST often returns an array
      const item = Array.isArray(created) ? created[0] : created;

      const renderId = item?.id;
      const status = item?.status || "planned";

      if (!renderId) {
        return json(res, 500, {
          ok: false,
          error: "Creatomate render response missing id",
          details: created,
        });
      }

      return json(res, 200, { ok: true, renderId, status });
    }

    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest("GET", `/v1/renders/${encodeURIComponent(id)}`, null);

      const status = String(r?.status || "").toLowerCase();
      const url = r?.url || r?.output_url || null;

      if (status === "failed") {
        return json(res, 200, {
          ok: true,
          status: "failed",
          error: r?.error || r?.message || "Render failed",
        });
      }

      if (status === "succeeded" && url) {
        return json(res, 200, { ok: true, status: "succeeded", url });
      }

      return json(res, 200, { ok: true, status: r?.status || "processing" });
    }

 } catch (err) {
  console.error("COMPOSITE_ERROR", err?.message, err?.creatomate || "");
  return json(res, 500, {
    ok: false,
    error: err?.message || String(err),
    details: err?.creatomate || null,
  }
};
