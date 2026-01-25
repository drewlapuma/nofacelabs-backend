// api/composite.js (CommonJS, Node 18 on Vercel)
//
// POST /api/composite (JSON)
// {
//   mainPath: "user/..../main.mp4"            // preferred (Supabase Storage path)
//   OR mainVideoUrl: "https://...mp4"         // optional
//
//   backgroundPath: "user/..../bg.mp4"        // preferred
//   OR backgroundVideoUrl: "https://...mp4"   // optional
//
//   layout: "sideBySide" | "topBottom",
//   mainSlot: "left"|"right"|"top"|"bottom",
//   mainSpeed: 1,
//   bgSpeed: 1,
//   bgMuted: true,
//
//   captions: {
//     enabled: true,
//     style: "sentence"|"karaoke"|...,
//     settings: { x:50, y:82, fontSize:48, fillColor:"#fff", strokeWidth:8.1, strokeColor:"#000", activeColor:"#00FF49", fontFamily:"...", fontWeight:700 }
//   }
// }
//
// Returns: { ok:true, renderId }
//
// GET /api/composite?id=<renderId>
// Returns: { ok:true, status:"rendering|succeeded|failed", url? }
//
// Notes:
// - Uses Creatomate template_id + modifications (fast + reliable)
// - Expects template has elements named: "input_video" and "bg_video"
// - Expects subtitle variants named like: "Subtitles_Sentence", "Subtitles_Karaoke", etc.
// - Background ALWAYS muted (volume=0, muted=true)

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

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
  } else {
    // fallback: allow same-origin + non-browser
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// -------------------- Memberstack auth (optional) --------------------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function requireMemberIdIfConfigured(req) {
  if (!ms) return null; // allow if not configured
  const token = getBearerToken(req);
  if (!token) {
    const e = new Error("MISSING_AUTH");
    e.code = "MISSING_AUTH";
    throw e;
  }
  const out = await ms.verifyToken({ token });
  return out?.id ? String(out.id) : null;
}

// -------------------- Creatomate --------------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();
const TEMPLATE_ID = (process.env.CREATOMATE_TEMPLATE_ID_COMPOSITE || process.env.CREATO_COMPOSITE_TEMPLATE_916 || "").trim();

// If your storage bucket for uploaded videos differs, set VIDEO_BUCKET env
const VIDEO_BUCKET = (process.env.VIDEO_BUCKET || process.env.USER_VIDEO_BUCKET || "user_videos").trim();

// Canvas dims for px->vmin conversions (9:16)
const CANVAS_W = 1080;
const CANVAS_H = 1920;

// -------------------- Your caption presets --------------------
const STYLE_PRESETS = {
  sentence: { fontFamily: "Inter", fontSize: 48, fillColor: "#ffffff", strokeWidth: 7.2, strokeColor: "#000000", fontWeight: 700 },
  word: { fontFamily: "Staatliches", fontSize: 48, fillColor: "#ffffff", strokeWidth: 8.1, strokeColor: "#000000", fontWeight: 400 },
  boldwhite: { fontFamily: "Luckiest Guy", fontSize: 48, fillColor: "#ffffff", strokeWidth: 9.9, strokeColor: "#00000040", fontWeight: 400 },
  karaoke: { fontFamily: "The Bold Font", fontSize: 48, fillColor: "#ffffff", strokeWidth: 8.1, strokeColor: "#000000", activeColor: "#00FF49", fontWeight: 700 },
  yellowpop: { fontFamily: "Komika Axis", fontSize: 48, fillColor: "#ffffff", strokeWidth: 10.8, strokeColor: "#000000", activeColor: "#FFFB00", fontWeight: 400 },
  minttag: { fontFamily: "Titan One", fontSize: 48, fillColor: "#ffffff", strokeWidth: 8.1, strokeColor: "#000000", activeColor: "#00D9FF", fontWeight: 400 },
  highlighter: { fontFamily: "Luckiest Guy", fontSize: 48, fillColor: "#ffffff", strokeWidth: 7.2, strokeColor: "#000000", activeColor: "#FDFF00", fontWeight: 400 },
  purplepop: { fontFamily: "Komika Axis", fontSize: 48, fillColor: "#ffffff", strokeWidth: 9, strokeColor: "#000000", activeColor: "#3F00FF", fontWeight: 400 },
  outlinepunch: { fontFamily: "Anton", fontSize: 48, fillColor: "#ffffff", strokeWidth: 11.7, strokeColor: "#000000", fontWeight: 400 },
  blackbar: { fontFamily: "Poppins", fontSize: 48, fillColor: "#ffffff", strokeWidth: 0, strokeColor: "#000000", backgroundColor: "#000000", fontWeight: 700 },
  neonglow: { fontFamily: "Titan One", fontSize: 48, fillColor: "#ffffff", strokeWidth: 0, strokeColor: "#000000", shadowColor: "#00D9FF", fontWeight: 400 },
  compactlowerthird: { fontFamily: "Inter", fontSize: 46, fillColor: "#ffffff", strokeWidth: 0, strokeColor: "#000000", fontWeight: 700 },
  bouncepop: { fontFamily: "Luckiest Guy", fontSize: 48, fillColor: "#ffffff", strokeWidth: 7.2, strokeColor: "#333333", fontWeight: 400 },
  redalert: { fontFamily: "Sigmar One", fontSize: 48, fillColor: "#ff2d2d", strokeWidth: 11.7, strokeColor: "#000000", fontWeight: 400 },
  redtag: { fontFamily: "Titan One", fontSize: 48, fillColor: "#ffffff", strokeWidth: 8.1, strokeColor: "#000000", activeColor: "#F6295C", fontWeight: 400 },
};

const BASE_DEFAULTS = {
  x: 50,
  y: 50,
  textTransform: "none",
  fontFamily: "Inter",
  fontWeight: 400,
  fontSize: 48,
  fillColor: "#ffffff",
  strokeWidth: 0,
  strokeColor: "#000000",
  activeColor: "#A855F7",
  backgroundColor: "#000000",
  shadowColor: "#00D9FF",
};

const EFFECT_MAP = {
  sentence: "sentence",
  word: "word",
  boldwhite: "sentence",
  karaoke: "karaoke",
  yellowpop: "karaoke",
  minttag: "karaoke",
  highlighter: "karaoke",
  purplepop: "karaoke",
  redtag: "karaoke",
  outlinepunch: "sentence",
  blackbar: "sentence",
  neonglow: "sentence",
  compactlowerthird: "sentence",
  bouncepop: "sentence",
  redalert: "sentence",
};

const SUBTITLE_NAME_MAP = {
  sentence: "Subtitles_Sentence",
  word: "Subtitles_Word",
  boldwhite: "Subtitles_BoldWhite",
  karaoke: "Subtitles_Karaoke",
  yellowpop: "Subtitles_YellowPop",
  minttag: "Subtitles_MintTag",
  highlighter: "Subtitles_Highlighter",
  purplepop: "Subtitles_PurplePop",
  outlinepunch: "Subtitles_OutlinePunch",
  blackbar: "Subtitles_BlackBar",
  neonglow: "Subtitles_NeonGlow",
  compactlowerthird: "Subtitles_CompactLowerThird",
  bouncepop: "Subtitles_BouncePop",
  redalert: "Subtitles_RedAlert",
  redtag: "Subtitles_RedTag",
};

// -------------------- helpers --------------------
function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toPercentString(v) {
  return `${clamp(v, 0, 100)}%`;
}

function pxToVmin(px, canvasW = CANVAS_W, canvasH = CANVAS_H) {
  const vminPx = Math.min(canvasW, canvasH) / 100; // 10.8 for 1080x1920
  return Number(px) / vminPx;
}

const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function snapSpeed(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  let best = SPEED_STEPS[0];
  let bestD = Infinity;
  for (const s of SPEED_STEPS) {
    const d = Math.abs(s - n);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function getSlotRects(layout, mainSlot) {
  // returns center-based percent rects: { x,y,w,h }
  if (layout === "topBottom") {
    if (mainSlot === "bottom") {
      return {
        main: { x: 50, y: 75, w: 100, h: 50 },
        bg:   { x: 50, y: 25, w: 100, h: 50 },
      };
    }
    return {
      main: { x: 50, y: 25, w: 100, h: 50 },
      bg:   { x: 50, y: 75, w: 100, h: 50 },
    };
  }

  // sideBySide
  if (mainSlot === "right") {
    return {
      main: { x: 75, y: 50, w: 50, h: 100 },
      bg:   { x: 25, y: 50, w: 50, h: 100 },
    };
  }
  return {
    main: { x: 25, y: 50, w: 50, h: 100 },
    bg:   { x: 75, y: 50, w: 50, h: 100 },
  };
}

function buildSubtitleProps(styleKey, overrides = {}) {
  const preset = STYLE_PRESETS[styleKey] || {};
  const merged = { ...BASE_DEFAULTS, ...preset, ...(overrides || {}) };

  const effect = EFFECT_MAP[styleKey] || "sentence";
  const fontSizeVmin = pxToVmin(merged.fontSize);
  const strokeVmin = pxToVmin(merged.strokeWidth);

  const props = {
    x_alignment: toPercentString(merged.x),
    y_alignment: toPercentString(merged.y),

    font_family: merged.fontFamily,
    font_weight: String(merged.fontWeight ?? 400),

    font_size: `${fontSizeVmin.toFixed(2)} vmin`,
    fill_color: merged.fillColor,
    stroke_color: merged.strokeColor,
    stroke_width: `${strokeVmin.toFixed(2)} vmin`,

    transcript_effect: effect,
    transcript_color: merged.activeColor,    // ✅ active highlight color
    transcript_source: "input_video",
    dynamic: true,
  };

  // keep blackbar + neonglow behavior
  if (styleKey === "blackbar") props.background_color = merged.backgroundColor || "#000000";
  if (styleKey === "neonglow") props.shadow_color = merged.shadowColor || "#00D9FF";

  // strip undefined
  Object.keys(props).forEach(k => props[k] === undefined && delete props[k]);
  return props;
}

function httpsJson({ method, hostname, path, headers, bodyObj }) {
  return new Promise((resolve, reject) => {
    const body = bodyObj ? JSON.stringify(bodyObj) : null;

    const req = https.request(
      { method, hostname, path, headers },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (d) => (raw += d));
        res.on("end", () => {
          let parsed = {};
          try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`HTTP ${res.statusCode} ${method} ${path} :: ${raw || "no body"}`));
          }
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function signedReadUrl(sb, path, expiresSec = 60 * 60) {
  const clean = String(path || "").replace(/^\/+/, "");
  const { data, error } = await sb.storage.from(VIDEO_BUCKET).createSignedUrl(clean, expiresSec);
  if (error || !data?.signedUrl) throw new Error("SIGNED_READ_URL_FAILED: " + (error?.message || "unknown"));
  return data.signedUrl;
}

async function creatomateGetRender(renderId) {
  const data = await httpsJson({
    method: "GET",
    hostname: "api.creatomate.com",
    path: `/v1/renders/${encodeURIComponent(renderId)}`,
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
  });
  return data;
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

function extractOutputUrl(obj) {
  const fromOutputs =
    Array.isArray(obj?.outputs) && obj.outputs.length
      ? obj.outputs[0]?.url || obj.outputs[0]?.output
      : null;

  return obj?.output || obj?.url || obj?.video_url || obj?.download_url || fromOutputs || null;
}

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    // optional auth (only enforced if MEMBERSTACK_SECRET_KEY set)
    await requireMemberIdIfConfigured(req);

    if (!CREATOMATE_API_KEY) return res.status(500).json({ ok:false, error: "MISSING_CREATOMATE_API_KEY" });
    if (!TEMPLATE_ID) return res.status(500).json({ ok:false, error: "MISSING_CREATOMATE_TEMPLATE_ID_COMPOSITE" });

    // ---------- GET status proxy ----------
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return res.status(400).json({ ok:false, error: "MISSING_ID" });

      const rObj = await creatomateGetRender(id);
      const st = normStatus(rObj?.status || "");
      const url = extractOutputUrl(rObj);

      return res.status(200).json({
        ok: true,
        status: st || rObj?.status || "rendering",
        url: st === "succeeded" ? (url || null) : (url || null),
        error: st === "failed" ? (rObj?.error || rObj?.message || null) : null,
        raw_status: rObj?.status || null,
      });
    }

    // ---------- POST create render ----------
    if (req.method !== "POST") return res.status(405).json({ ok:false, error: "METHOD_NOT_ALLOWED" });

    const body = typeof req.body === "string" ? (safeJsonParse(req.body) || {}) : (req.body || {});

    const sb = getAdminSupabase();

    const layout = (String(body.layout || "sideBySide") === "topBottom") ? "topBottom" : "sideBySide";
    const mainSlotRaw = String(body.mainSlot || (layout === "topBottom" ? "top" : "left")).toLowerCase();
    const mainSlot = (layout === "topBottom")
      ? (mainSlotRaw === "bottom" ? "bottom" : "top")
      : (mainSlotRaw === "right" ? "right" : "left");

    const mainSpeed = snapSpeed(body.mainSpeed);
    const bgSpeed = snapSpeed(body.bgSpeed);

    const bgMuted = true; // ✅ always muted per your requirement

    // Resolve main/background URLs
    const mainPath = String(body.mainPath || "").trim();
    const bgPath = String(body.backgroundPath || "").trim();

    let mainVideoUrl = String(body.mainVideoUrl || "").trim();
    let backgroundVideoUrl = String(body.backgroundVideoUrl || "").trim();

    if (!mainVideoUrl) {
      if (!mainPath) return res.status(400).json({ ok:false, error: "mainPath or mainVideoUrl required" });
      mainVideoUrl = await signedReadUrl(sb, mainPath);
    }
    if (!backgroundVideoUrl) {
      if (!bgPath) return res.status(400).json({ ok:false, error: "backgroundPath or backgroundVideoUrl required" });
      backgroundVideoUrl = await signedReadUrl(sb, bgPath);
    }

    // Captions
    const captions = (body.captions && typeof body.captions === "object") ? body.captions : {};
    const captionsEnabled = !!captions.enabled;
    const captionStyle = String(captions.style || "sentence").toLowerCase();
    const captionOverrides = (captions.settings && typeof captions.settings === "object") ? captions.settings : {};

    if (captionsEnabled && !STYLE_PRESETS[captionStyle]) {
      return res.status(400).json({ ok:false, error: `Unknown caption style: ${captionStyle}` });
    }

    const rects = getSlotRects(layout, mainSlot);

    // Build modifications (Creatomate)
    const mods = {};

    // Video sources (template must have these element names)
    mods["input_video.source"] = mainVideoUrl;
    mods["bg_video.source"] = backgroundVideoUrl;

    // Ensure fill/crop
    mods["input_video.fit"] = "cover";
    mods["bg_video.fit"] = "cover";

    // Slot placement
    mods["input_video.x_alignment"] = toPercentString(rects.main.x);
    mods["input_video.y_alignment"] = toPercentString(rects.main.y);
    mods["input_video.width"] = `${rects.main.w}%`;
    mods["input_video.height"] = `${rects.main.h}%`;

    mods["bg_video.x_alignment"] = toPercentString(rects.bg.x);
    mods["bg_video.y_alignment"] = toPercentString(rects.bg.y);
    mods["bg_video.width"] = `${rects.bg.w}%`;
    mods["bg_video.height"] = `${rects.bg.h}%`;

    // Speeds
    mods["input_video.playback_rate"] = mainSpeed;
    mods["bg_video.playback_rate"] = bgSpeed;

    // Background muted always
    mods["bg_video.volume"] = 0;
    mods["bg_video.muted"] = true;

    // Captions: show exactly one Subtitles_* layer and apply settings
    const chosenSubtitleName = SUBTITLE_NAME_MAP[captionStyle] || null;

    // Hide all known variants
    Object.values(SUBTITLE_NAME_MAP).forEach((name) => {
      mods[`${name}.visible`] = false;
    });

    if (captionsEnabled && chosenSubtitleName) {
      mods[`${chosenSubtitleName}.visible`] = true;

      const props = buildSubtitleProps(captionStyle, captionOverrides);

      // Apply caption props via modifications: "ElementName.property"
      Object.keys(props).forEach((k) => {
        mods[`${chosenSubtitleName}.${k}`] = props[k];
      });
    }

    const payload = {
      template_id: TEMPLATE_ID,
      modifications: mods,
      output_format: "mp4",
    };

    const created = await httpsJson({
      method: "POST",
      hostname: "api.creatomate.com",
      path: "/v1/renders",
      headers: {
        Authorization: `Bearer ${CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      bodyObj: payload,
    });

    // Creatomate sometimes returns array
    const renderId = Array.isArray(created) ? created[0]?.id : created?.id;
    if (!renderId) return res.status(502).json({ ok:false, error: "NO_RENDER_ID", details: created });

    return res.status(200).json({ ok:true, renderId });
  } catch (err) {
    const msg = String(err?.message || err);

    if (err?.code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) {
      return res.status(401).json({ ok:false, error: "MISSING_AUTH" });
    }

    console.error("[COMPOSITE] error", err);
    return res.status(500).json({ ok:false, error: msg || "SERVER_ERROR" });
  }
};
