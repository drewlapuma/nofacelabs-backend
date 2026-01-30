// api/composite.js (CommonJS, Node 18+ on Vercel)
//
// ✅ UPDATED to make Split Screen renders appear in /my-videos:
//
// What it does now:
// - Requires Memberstack auth (Authorization: Bearer <token>)
// - POST /api/composite
//    1) Inserts a row into Supabase `renders` tied to member_id (kind="composite")
//    2) Starts Creatomate render
//    3) Saves composite_render_id on that row
//    4) Returns { ok:true, id:<dbRowId>, renderId:<creatomateId>, status }
// - GET /api/composite?id=<creatomateId>
//    1) Verifies the render belongs to this member (via renders table)
//    2) Checks Creatomate status
//    3) When succeeded, updates composite_video_url + composite_status in the row
//
// Notes:
// - Your /my-videos frontend already prefers composite_video_url > captioned_video_url > video_url
// - Make sure your split screen frontend sends Authorization header to /api/composite (POST and GET)

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");
const { createClient } = require("@supabase/supabase-js");

// -------------------- CORS --------------------
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    // Echo origin if present so browsers accept credentialed/auth requests
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// -------------------- Response helpers --------------------
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  // Vercel sometimes parses req.body for you
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

// -------------------- Supabase admin --------------------
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

async function signedReadUrl(sb, bucket, path, expiresIn = 3600) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Signed read URL error: ${error?.message || "Object not found"}`);
  }
  return data.signedUrl;
}

// -------------------- Memberstack auth --------------------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isExpiredJwtError(err) {
  const code = err?.code;
  const msg = String(err?.message || "").toLowerCase();

  if (code === "ERR_JWT_EXPIRED") return true;
  if (msg.includes("jwtexpired") || msg.includes("jwt expired")) return true;
  if (msg.includes("token_expired")) return true;

  return false;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) {
    const e = new Error("MISSING_AUTH");
    e.code = "MISSING_AUTH";
    throw e;
  }
  if (!ms) {
    const e = new Error("MISSING_MEMBERSTACK_SECRET_KEY");
    e.code = "MISSING_MEMBERSTACK_SECRET_KEY";
    throw e;
  }

  try {
    const out = await ms.verifyToken({ token });
    const id = out?.id;
    if (!id) {
      const e = new Error("INVALID_MEMBER_TOKEN");
      e.code = "INVALID_MEMBER_TOKEN";
      throw e;
    }
    return String(id);
  } catch (err) {
    if (isExpiredJwtError(err)) {
      const e = new Error("TOKEN_EXPIRED");
      e.code = "TOKEN_EXPIRED";
      throw e;
    }
    throw err;
  }
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
  // Layout groups
  const GROUP_SIDE = process.env.COMPOSITE_GROUP_SIDE || "Layout_SideBySide";
  const GROUP_TB = process.env.COMPOSITE_GROUP_TOPBOTTOM || "Layout_TopBottom";

  // Slot groups
  const SIDE_LEFT_GROUP = process.env.COMPOSITE_SIDE_LEFT_GROUP || "Main_Left";
  const SIDE_RIGHT_GROUP = process.env.COMPOSITE_SIDE_RIGHT_GROUP || "Main_Right";
  const TB_TOP_GROUP = process.env.COMPOSITE_TB_TOP_GROUP || "Main_Top";
  const TB_BOTTOM_GROUP = process.env.COMPOSITE_TB_BOTTOM_GROUP || "Main_Bottom";

  // Main visual layers
  const MAIN_SIDE_LEFT = process.env.COMPOSITE_MAIN_SIDE_LEFT || "input_video_visual_side_left";
  const MAIN_SIDE_RIGHT = process.env.COMPOSITE_MAIN_SIDE_RIGHT || "input_video_visual_side_right";
  const MAIN_TB_TOP = process.env.COMPOSITE_MAIN_TB_TOP || "input_video_visual_tb_top";
  const MAIN_TB_BOTTOM = process.env.COMPOSITE_MAIN_TB_BOTTOM || "input_video_visual_tb_bottom";

  // BG visual layers (hyphens are correct)
  const BG_SIDE_LEFT = process.env.COMPOSITE_BG_SIDE_LEFT || "bg-video_side_left";
  const BG_SIDE_RIGHT = process.env.COMPOSITE_BG_SIDE_RIGHT || "bg-video_side_right";
  const BG_TB_TOP = process.env.COMPOSITE_BG_TB_TOP || "bg-video_tb_top";
  const BG_TB_BOTTOM = process.env.COMPOSITE_BG_TB_BOTTOM || "bg-video_tb_bottom";

  // Hidden audio/transcript feeder
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

  const ACTIVE_COLOR_LAYERS = new Set([
    "Subtitles_Karaoke",
    "Subtitles_YellowPop",
    "Subtitles_MintTag",
    "Subtitles_Highlighter",
    "Subtitles_PurplePop",
    "Subtitles_RedTag",
  ]);

  const layout = payload.layout === "topBottom" ? "topBottom" : "sideBySide";

  const mainSlotRaw = String(payload.mainSlot || payload.main_slot || "left").toLowerCase();
  const mainSlot = ["left", "right", "top", "bottom"].includes(mainSlotRaw) ? mainSlotRaw : "left";

  const mainSpeed = Number(payload.mainSpeed || payload.main_speed || 1);
  const bgSpeed = Number(payload.bgSpeed || payload.bg_speed || 1);

  const bgMuted = (payload.bgMuted ?? payload.bg_muted) !== false; // default true

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

  const transcriptColor = ACTIVE_COLOR_LAYERS.has(pickedSubtitleLayer)
    ? (
        settings.transcript_color ??
        settings.transcriptColor ??
        settings.activeColor ??
        settings.active_color
      )
    : null;

  const m = {};

  function clampSpeed(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 1;
    return Math.min(4, Math.max(0.25, n));
  }

  function speedToPercentString(speed) {
    const s = clampSpeed(speed);
    return `${(s * 100).toFixed(1)}%`;
  }

  function setVideoLayer(layerName, url, { visible = true, opacity = "100%", volume = "0%", speed = 1 } = {}) {
    m[layerName] = String(url);
    m[`${layerName}.visible`] = !!visible;
    m[`${layerName}.opacity`] = String(opacity);
    m[`${layerName}.volume`] = String(volume);
    m[`${layerName}.speed`] = speedToPercentString(speed);
  }

  function setSubtitleProp(layer, key, value) {
    if (value === undefined || value === null) return;
    const s = String(value).trim();
    if (!s) return;
    m[`${layer}.${key}`] = s;
  }

  // 1) Layout visibility
  m[`${GROUP_SIDE}.visible`] = layout === "sideBySide";
  m[`${GROUP_TB}.visible`] = layout === "topBottom";

  // 2) Force slot groups visible for active layout
  m[`${SIDE_LEFT_GROUP}.visible`] = layout === "sideBySide";
  m[`${SIDE_RIGHT_GROUP}.visible`] = layout === "sideBySide";
  m[`${TB_TOP_GROUP}.visible`] = layout === "topBottom";
  m[`${TB_BOTTOM_GROUP}.visible`] = layout === "topBottom";

  // 3) Default state
  const VIS_MUTED = "0%";
  const BG_VOL = bgMuted ? "0%" : "100%";

  const ALL_MAIN = [MAIN_SIDE_LEFT, MAIN_SIDE_RIGHT, MAIN_TB_TOP, MAIN_TB_BOTTOM];
  const ALL_BG = [BG_SIDE_LEFT, BG_SIDE_RIGHT, BG_TB_TOP, BG_TB_BOTTOM];

  for (const layer of ALL_MAIN) {
    setVideoLayer(layer, mainUrl, { visible: true, opacity: "0%", volume: VIS_MUTED, speed: mainSpeed });
  }
  for (const layer of ALL_BG) {
    setVideoLayer(layer, bgUrl, { visible: true, opacity: "0%", volume: BG_VOL, speed: bgSpeed });
  }

  // 4) Place main + bg
  if (layout === "sideBySide") {
    if (mainSlot === "right") {
      m[`${MAIN_SIDE_RIGHT}.opacity`] = "100%";
      m[`${BG_SIDE_LEFT}.opacity`] = "100%";
    } else {
      m[`${MAIN_SIDE_LEFT}.opacity`] = "100%";
      m[`${BG_SIDE_RIGHT}.opacity`] = "100%";
    }
  } else {
    if (mainSlot === "bottom") {
      m[`${MAIN_TB_BOTTOM}.opacity`] = "100%";
      m[`${BG_TB_TOP}.opacity`] = "100%";
    } else {
      m[`${MAIN_TB_TOP}.opacity`] = "100%";
      m[`${BG_TB_BOTTOM}.opacity`] = "100%";
    }
  }

  // 5) Hidden audio/transcript feeder (audible, invisible, speed matched)
  setVideoLayer(MAIN_AUDIO, mainUrl, {
    visible: true,
    opacity: "0%",
    volume: "100%",
    speed: mainSpeed,
  });

  // 6) Captions
  for (const name of SUBTITLE_LAYERS) m[`${name}.visible`] = false;

  m[`${pickedSubtitleLayer}.visible`] = !!capEnabled;
  m[`${pickedSubtitleLayer}.transcript_effect`] = transcript_effect;
  m[`${pickedSubtitleLayer}.transcript_source`] = MAIN_AUDIO;

  // styling settings (accept camelCase or snake_case)
  const fill = settings.fill_color ?? settings.fillColor;
  const stroke = settings.stroke_color ?? settings.strokeColor;
  const strokeWidth = settings.stroke_width ?? settings.strokeWidth;
  const fontFamily = settings.font_family ?? settings.fontFamily;
  const fontSize = settings.font_size ?? settings.fontSize;
  const textTransform = settings.text_transform ?? settings.textTransform;

  setSubtitleProp(pickedSubtitleLayer, "fill_color", fill);
  setSubtitleProp(pickedSubtitleLayer, "stroke_color", stroke);

  if (strokeWidth !== undefined && strokeWidth !== null) {
    m[`${pickedSubtitleLayer}.stroke_width`] = String(strokeWidth);
  }

  setSubtitleProp(pickedSubtitleLayer, "font_family", fontFamily);

  if (fontSize !== undefined && fontSize !== null) {
    m[`${pickedSubtitleLayer}.font_size`] = String(fontSize);
  }

  setSubtitleProp(pickedSubtitleLayer, "text_transform", textTransform);

  function toPercent(v, fallback = "50%") {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    const clamped = Math.max(0, Math.min(100, n));
    return `${clamped}%`;
  }

  const x = settings.x_alignment ?? settings.xAlignment ?? settings.x;
  const y = settings.y_alignment ?? settings.yAlignment ?? settings.y;

  m[`${pickedSubtitleLayer}.x_alignment`] = toPercent(x, "50%");
  m[`${pickedSubtitleLayer}.y_alignment`] = toPercent(y, "50%");

  if (transcriptColor) {
    m[`${pickedSubtitleLayer}.transcript_color`] = String(transcriptColor);
  }

  if (pickedSubtitleLayer === "Subtitles_BlackBar") {
    const bgColor = settings.background_color ?? settings.backgroundColor;
    setSubtitleProp(pickedSubtitleLayer, "background_color", bgColor);
  }

  if (pickedSubtitleLayer === "Subtitles_NeonGlow") {
    const shColor = settings.shadow_color ?? settings.shadowColor;
    setSubtitleProp(pickedSubtitleLayer, "shadow_color", shColor);
  }

  return m;
}

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    // 🔒 require login for BOTH POST and GET (ties renders to member)
    const member_id = await requireMemberId(req);
    const sb = getSupabaseAdmin();

    const BUCKET =
      process.env.SUPABASE_UPLOAD_BUCKET ||
      process.env.USER_VIDEOS_BUCKET ||
      "user-uploads";

    // -------------------- POST: Start composite --------------------
    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json(res, 400, { ok: false, error: "Missing body" });
      if (body === "__INVALID__") return json(res, 400, { ok: false, error: "Invalid JSON" });

      const templateId =
        process.env.COMPOSITE_TEMPLATE_ID ||
        process.env.CREATOMATE_TEMPLATE_ID_COMPOSITE ||
        process.env.CREATOMATE_TEMPLATE_ID;

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

      // ✅ Insert DB row FIRST so it appears in /my-videos immediately as "rendering"
      const choices = {
        kind: "composite",
        videoName: String(body.videoName || "Untitled split-screen video"),
        layout: body.layout,
        mainSlot: body.mainSlot,
        mainSpeed: body.mainSpeed,
        bgSpeed: body.bgSpeed,
        bgMuted: body.bgMuted,
        captions: body.captions || {},
        mainPath: body.mainPath || null,
        backgroundPath: body.backgroundPath || null,
        backgroundVideoUrl: body.backgroundVideoUrl || null,
      };

      const { data: row, error: insErr } = await sb
        .from("renders")
        .insert([{
          member_id,
          kind: "composite",
          composite_status: "rendering",
          composite_error: null,
          composite_video_url: null,
          composite_render_id: null,
          choices,
        }])
        .select("id")
        .single();

      if (insErr || !row?.id) {
        return json(res, 500, { ok: false, error: "DB_INSERT_FAILED", details: insErr });
      }

      const dbId = row.id;

      // Signed URLs to feed Creatomate
      const mainUrl = await signedReadUrl(sb, BUCKET, mainPath, 60 * 60);
      const bgUrl = backgroundVideoUrl
        ? String(backgroundVideoUrl)
        : await signedReadUrl(sb, BUCKET, backgroundPath, 60 * 60);

      const modifications = buildModifications({ mainUrl, bgUrl, payload: body });

      let created;
      try {
        created = await creatomateRequest("POST", "/v1/renders", {
          template_id: templateId,
          modifications,
          output_format: "mp4",
        });
      } catch (e) {
        // mark row failed if Creatomate call fails
        await sb.from("renders").update({
          composite_status: "failed",
          composite_error: e?.message || String(e),
        }).eq("id", dbId).eq("member_id", member_id);

        throw e;
      }

      const item = Array.isArray(created) ? created[0] : created;
      const renderId = item?.id;
      const status = item?.status || "planned";

      if (!renderId) {
        await sb.from("renders").update({
          composite_status: "failed",
          composite_error: "CREATOMATE_RESPONSE_MISSING_ID",
        }).eq("id", dbId).eq("member_id", member_id);

        return json(res, 502, { ok: false, error: "Creatomate response missing id", details: created });
      }

      // ✅ Save Creatomate render id
      await sb.from("renders").update({
        composite_render_id: String(renderId),
        composite_status: "rendering",
        composite_error: null,
      }).eq("id", dbId).eq("member_id", member_id);

      return json(res, 200, { ok: true, id: dbId, renderId: String(renderId), status });
    }

    // -------------------- GET: Poll composite --------------------
    if (req.method === "GET") {
      const renderId = String(req.query?.id || "").trim();
      if (!renderId) return json(res, 400, { ok: false, error: "Missing id" });

      // ✅ Ownership: find the row for this member + this creatomate render id
      const { data: row, error: rowErr } = await sb
        .from("renders")
        .select("id, composite_video_url, composite_status")
        .eq("member_id", member_id)
        .eq("composite_render_id", renderId)
        .single();

      if (rowErr || !row) {
        return json(res, 404, { ok: false, error: "NOT_FOUND" });
      }

      // ✅ If already finished, return immediately
      if (row.composite_video_url) {
        return json(res, 200, { ok: true, status: row.composite_status || "succeeded", url: row.composite_video_url });
      }

      const r = await creatomateRequest("GET", `/v1/renders/${encodeURIComponent(renderId)}`, null);
      const status = String(r?.status || "").toLowerCase();
      const url = r?.url || r?.output_url || null;

      if (status === "failed") {
        const errMsg = r?.error || r?.message || "Render failed";
        await sb.from("renders").update({
          composite_status: "failed",
          composite_error: String(errMsg),
        }).eq("id", row.id).eq("member_id", member_id);

        return json(res, 200, { ok: true, status: "failed", error: errMsg });
      }

      if ((status === "succeeded" || status === "completed") && url) {
        await sb.from("renders").update({
          composite_status: "succeeded",
          composite_video_url: String(url),
          composite_error: null,
        }).eq("id", row.id).eq("member_id", member_id);

        return json(res, 200, { ok: true, status: "succeeded", url: String(url) });
      }

      return json(res, 200, { ok: true, status: r?.status || "processing" });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = err?.code;

    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) {
      return json(res, 401, {
        ok: false,
        error: "TOKEN_EXPIRED",
        message: "Session expired. Refresh the page and try again.",
      });
    }

    if (code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) {
      return json(res, 401, { ok: false, error: "MISSING_AUTH" });
    }

    if (code === "INVALID_MEMBER_TOKEN" || msg.includes("INVALID_MEMBER")) {
      return json(res, 401, { ok: false, error: "INVALID_MEMBER_TOKEN" });
    }

    if (code === "MISSING_MEMBERSTACK_SECRET_KEY") {
      return json(res, 500, { ok: false, error: "MISSING_MEMBERSTACK_SECRET_KEY" });
    }

    console.error("[COMPOSITE] SERVER_ERROR", err);
    return json(res, 500, {
      ok: false,
      error: "SERVER_ERROR",
      message: msg,
      statusCode: err?.statusCode || null,
      details: err?.details || null,
    });
  }
};
