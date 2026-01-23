// api/user-video-caption.js (CommonJS, Node 18+)
// POST { path, captionStyle, captionSettings }
// Returns { renderId }
//
// ✅ Fixes:
// - Supports BOTH naming styles from your UI (fill vs fill_color vs fillColor, etc.)
// - Normalizes colors to HEX where possible
// - Uses px for font_size + stroke_width when user sends numbers (prevents gigantic vmin sizes)
// - Uses correct field for active effect color: transcript_color
// - Keeps x/y behavior (percent strings)
// - Defaults font size to 48px if none provided
// - Optional: maps font family if you send it (font_family / fontFamily)

const https = require("https");

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

  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
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

function httpJson(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj)) : null;

    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          ...(headers || {}),
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": payload.length }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed || {});
          return reject(
            new Error(parsed?.error || parsed?.message || data || "HTTP " + res.statusCode)
          );
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// UI style -> Creatomate layer name (must match left panel)
const STYLE_TO_LAYER = {
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

const ALL_SUBTITLE_LAYERS = Array.from(new Set(Object.values(STYLE_TO_LAYER)));

function normalizeStyleKey(s) {
  return String(s || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function pct(v, fallbackPct) {
  const n = Number(v);
  const use = Number.isFinite(n) ? n : fallbackPct;
  return `${use}%`;
}

// pick first defined key from captionSettings
function pick(cs, ...keys) {
  for (const k of keys) {
    if (cs && cs[k] !== undefined && cs[k] !== null && cs[k] !== "") return cs[k];
  }
  return undefined;
}

function safeStr(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function clampNumber(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function withUnit(val, defaultUnit) {
  if (val === undefined || val === null) return undefined;

  if (typeof val === "number") return `${val} ${defaultUnit}`;

  const s = String(val).trim();
  if (!s) return undefined;

  // already has any unit or %
  if (/[a-z%]/i.test(s)) return s;

  // numeric string => attach unit
  if (/^\d+(\.\d+)?$/.test(s)) return `${s} ${defaultUnit}`;

  return s;
}

function normHex(val) {
  if (val === undefined || val === null) return undefined;
  let s = String(val).trim();
  if (!s) return undefined;

  if (!s.startsWith("#") && /^[0-9a-f]{3,8}$/i.test(s)) s = `#${s}`;
  return s;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const body = await readJson(req);
  if (!body) return sendJson(res, 400, { error: "Missing body" });
  if (body === "__INVALID__") return sendJson(res, 400, { error: "Invalid JSON" });

  const { path, captionStyle, captionSettings } = body;
  if (!path) return sendJson(res, 400, { error: "path is required" });

  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  const TEMPLATE_ID = process.env.CREATOMATE_CAPTION_TEMPLATE_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const BUCKET = process.env.USER_VIDEOS_BUCKET || "user-uploads";

  if (!CREATOMATE_API_KEY) return sendJson(res, 500, { error: "Missing CREATOMATE_API_KEY env var" });
  if (!TEMPLATE_ID) return sendJson(res, 500, { error: "Missing CREATOMATE_CAPTION_TEMPLATE_ID env var" });
  if (!SUPABASE_URL) return sendJson(res, 500, { error: "Missing SUPABASE_URL env var" });

  const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  const styleKey = normalizeStyleKey(captionStyle);
  const chosenLayer = STYLE_TO_LAYER[styleKey] || STYLE_TO_LAYER.sentence;

  const cs = captionSettings && typeof captionSettings === "object" ? captionSettings : {};

  const FONT_UNIT = "px";
  const STROKE_UNIT = "px";
  const DEFAULT_FONT_SIZE = 48; // ✅ your new default

  const modifications = {
    "input_video.source": videoUrl,
  };

  // Hide all subtitle layers
  for (const id of ALL_SUBTITLE_LAYERS) {
    modifications[`${id}.visible`] = false;
  }
  // Show chosen
  modifications[`${chosenLayer}.visible`] = true;

  // Positioning (percent strings)
  const x = pick(cs, "x");
  const y = pick(cs, "y");
  if (x !== undefined) modifications[`${chosenLayer}.x`] = pct(x, 50);
  if (y !== undefined) modifications[`${chosenLayer}.y`] = pct(y, 85);

  const xa = pick(cs, "x_alignment", "xAlignment");
  const ya = pick(cs, "y_alignment", "yAlignment");
  if (xa !== undefined) modifications[`${chosenLayer}.x_alignment`] = pct(xa, 50);
  if (ya !== undefined) modifications[`${chosenLayer}.y_alignment`] = pct(ya, 50);

  // Style keys (support multiple names your UI might send)
  const fontFamily = pick(cs, "font", "fontFamily", "font_family");
  const fontSizeRaw = pick(cs, "size", "fontSize", "font_size");

  const fill = normHex(pick(cs, "fill", "fillColor", "fill_color", "fillColorHex"));
  const stroke = normHex(pick(cs, "stroke", "strokeColor", "stroke_color", "strokeColorHex"));
  const strokeWidthRaw = pick(cs, "stroke_width", "strokeWidth");

  const activeColor = normHex(
    pick(cs, "transcript_color", "activeColor", "active_color", "effectColor", "effect_color")
  );

  // Font family
  if (fontFamily) modifications[`${chosenLayer}.font_family`] = safeStr(fontFamily);

  // ✅ Font size: DEFAULT to 48px if missing
  if (fontSizeRaw !== undefined) {
    if (typeof fontSizeRaw === "number" || /^\d+(\.\d+)?$/.test(String(fontSizeRaw).trim())) {
      const n = clampNumber(fontSizeRaw, 10, 160);
      if (n !== null) modifications[`${chosenLayer}.font_size`] = `${n} ${FONT_UNIT}`;
    } else {
      modifications[`${chosenLayer}.font_size`] = withUnit(fontSizeRaw, FONT_UNIT);
    }
  } else {
    modifications[`${chosenLayer}.font_size`] = `${DEFAULT_FONT_SIZE} ${FONT_UNIT}`;
  }

  // Colors
  if (fill) modifications[`${chosenLayer}.fill_color`] = safeStr(fill);
  if (stroke) modifications[`${chosenLayer}.stroke_color`] = safeStr(stroke);

  // Stroke width
  if (strokeWidthRaw !== undefined) {
    if (typeof strokeWidthRaw === "number" || /^\d+(\.\d+)?$/.test(String(strokeWidthRaw).trim())) {
      const n = clampNumber(strokeWidthRaw, 0, 20);
      if (n !== null) modifications[`${chosenLayer}.stroke_width`] = `${n} ${STROKE_UNIT}`;
    } else {
      modifications[`${chosenLayer}.stroke_width`] = withUnit(strokeWidthRaw, STROKE_UNIT);
    }
  }

  // Active / karaoke effect color
  if (activeColor) modifications[`${chosenLayer}.transcript_color`] = safeStr(activeColor);

  try {
    const renderResp = await httpJson(
      "POST",
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
      { template_id: TEMPLATE_ID, modifications }
    );

    const renderId = Array.isArray(renderResp) ? renderResp?.[0]?.id : renderResp?.id;
    if (!renderId) {
      return sendJson(res, 500, { error: "Missing renderId from Creatomate", debug: renderResp });
    }

    return sendJson(res, 200, { renderId });
  } catch (err) {
    return sendJson(res, 500, { error: err?.message || "CREATOMATE_RENDER_FAILED" });
  }
};
