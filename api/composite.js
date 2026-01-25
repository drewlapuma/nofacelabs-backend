// api/composite.js (CommonJS, Node 18 on Vercel)
//
// POST /api/composite
// Body (JSON):
// {
//   mainPath: "user_uploads/....mp4"               // preferred (Supabase storage path)
//   backgroundPath: "user_uploads/....mp4"         // OR
//   backgroundVideoUrl: "https://....mp4"          // optional if using library URL
//   layout: "sideBySide" | "topBottom",
//   mainSlot: "left"|"right"|"top"|"bottom",
//   mainSpeed: 1.0,
//   bgSpeed: 1.25,
//   bgMuted: true,
//   captions: {
//     enabled: true,
//     style: "karaoke"|"sentence"|...,
//     settings: { x:50, y:82, fontSize:48, fillColor:"#fff", strokeWidth:8.1, strokeColor:"#000", activeColor:"#00FF49", fontFamily:"...", fontWeight:700 }
//   }
// }
//
// GET /api/composite?id=CREATOMATE_RENDER_ID
// -> { status, url?, error? }

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
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// -------------------- ENV --------------------
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID_COMPOSITE;

// Supabase (service role) for signing read URLs from storage paths
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "videos"; // set this to your real bucket name
const SIGNED_URL_TTL_SECONDS = Number(process.env.SIGNED_URL_TTL_SECONDS || 60 * 30); // 30 min

function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// -------------------- Caption presets --------------------
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
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function httpsJson({ method, hostname, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname, path, headers }, (res) => {
      let raw = "";
      res.on("data", (d) => (raw += d));
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${method} ${path} :: ${raw || "no body"}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toPercentString(v) {
  return `${clamp(v, 0, 100)}%`;
}

function pxToVmin(px, canvasW = 1080, canvasH = 1920) {
  const vminPx = Math.min(canvasW, canvasH) / 100;
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

function buildSubtitleProps(styleKey, overrides = {}, canvasW = 1080, canvasH = 1920) {
  const preset = STYLE_PRESETS[styleKey] || {};
  const merged = { ...BASE_DEFAULTS, ...preset, ...overrides };
  const effect = EFFECT_MAP[styleKey] || "sentence";

  const fontSizeVmin = pxToVmin(merged.fontSize, canvasW, canvasH);
  const strokeVmin = pxToVmin(merged.strokeWidth, canvasW, canvasH);

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
    transcript_color: merged.activeColor,   // active highlight color
    transcript_source: "input_video",       // ✅ use your existing template input video
    dynamic: true,
  };

  if (styleKey === "blackbar") props.background_color = merged.backgroundColor || "#000000";
  if (styleKey === "neonglow") props.shadow_color = merged.shadowColor || "#00D9FF";

  Object.keys(props).forEach((k) => props[k] === undefined && delete props[k]);
  return props;
}

function getSlotRects(layout, mainSlot) {
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

function applyVideoSlot(el, rect, { muted, speed }) {
  el.x_alignment = toPercentString(rect.x);
  el.y_alignment = toPercentString(rect.y);
  el.width = `${rect.w}%`;
  el.height = `${rect.h}%`;

  el.playback_rate = speed;

  if (muted) {
    el.volume = 0;
    el.muted = true;
  }
}

function applyCaptions(template, styleKey, overrides, canvasW, canvasH) {
  const chosenName = SUBTITLE_NAME_MAP[styleKey] || null;

  for (const el of template.elements || []) {
    if (!el || typeof el !== "object") continue;
    const name = String(el.name || "");

    if (!name.startsWith("Subtitles_")) continue;

    const isChosen = chosenName && name.toLowerCase() === chosenName.toLowerCase();
    el.visible = !!isChosen;

    if (isChosen) {
      const props = buildSubtitleProps(styleKey, overrides, canvasW, canvasH);
      Object.assign(el, props);
    }
  }
}

// -------------------- Creatomate --------------------
async function fetchTemplateJson(templateId) {
  const data = await httpsJson({
    method: "GET",
    hostname: "api.creatomate.com",
    path: `/v1/templates/${encodeURIComponent(templateId)}`,
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (data && typeof data.template === "object") return data.template;
  if (data && typeof data.source === "object") return data.source;
  if (data && typeof data === "object" && data.elements) return data;

  throw new Error("Could not read template JSON from Creatomate response.");
}

async function createRenderFromTemplate(templateObj) {
  const body = { template: templateObj, source: templateObj };

  const data = await httpsJson({
    method: "POST",
    hostname: "api.creatomate.com",
    path: "/v1/renders",
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  const renderId = data && (data.id || data.render_id || data.renderId);
  if (!renderId) throw new Error(`Creatomate render response missing id: ${JSON.stringify(data)}`);
  return renderId;
}

async function getRenderStatus(renderId) {
  const data = await httpsJson({
    method: "GET",
    hostname: "api.creatomate.com",
    path: `/v1/renders/${encodeURIComponent(renderId)}`,
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  // typical fields: status, url, error
  return {
    status: data?.status || "unknown",
    url: data?.url || data?.result_url || null,
    error: data?.error || null,
  };
}

// -------------------- Supabase signed read URL --------------------
async function signReadUrlFromPath(path, bucketOverride) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for signing read URLs.");
  }

  const bucket = String(bucketOverride || SUPABASE_BUCKET || "").trim();
  if (!bucket) throw new Error("Missing SUPABASE_BUCKET (or bucketOverride).");

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) throw new Error("Signed read URL error: " + error.message);
  if (!data?.signedUrl) throw new Error("Signed read URL missing signedUrl");
  return data.signedUrl;
}

// -------------------- handler --------------------
module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!CREATOMATE_API_KEY) return res.status(500).json({ error: "Missing CREATOMATE_API_KEY" });
    if (!TEMPLATE_ID) return res.status(500).json({ error: "Missing CREATOMATE_TEMPLATE_ID_COMPOSITE" });

    // GET: poll render status
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return res.status(400).json({ error: "id required" });

      const s = await getRenderStatus(id);
      return res.status(200).json(s);
    }

    // POST: start render
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = await readJson(req);

    // Accept either paths or urls
    const mainPath = String(body.mainPath || "").trim();
    const backgroundPath = String(body.backgroundPath || "").trim();
    const mainVideoUrlRaw = String(body.mainVideoUrl || "").trim();
    const backgroundVideoUrlRaw = String(body.backgroundVideoUrl || "").trim();

    if (!mainPath && !mainVideoUrlRaw) return res.status(400).json({ error: "mainPath or mainVideoUrl required" });
    if (!backgroundPath && !backgroundVideoUrlRaw) return res.status(400).json({ error: "backgroundPath or backgroundVideoUrl required" });

    const layout = (body.layout === "topBottom" ? "topBottom" : "sideBySide");
    const mainSlot = String(body.mainSlot || (layout === "topBottom" ? "top" : "left")).toLowerCase();

    const mainSpeed = snapSpeed(body.mainSpeed);
    const bgSpeed = snapSpeed(body.bgSpeed);

    const bgMuted = body.bgMuted !== false; // default true

    const captions = body.captions || {};
    const captionsEnabled = !!captions.enabled;
    const captionStyle = String(captions.style || "sentence").toLowerCase();
    const captionOverrides = captions.settings && typeof captions.settings === "object" ? captions.settings : {};

    // Resolve sources
    const mainBucket = String(body.mainBucket || "").trim();
const backgroundBucket = String(body.backgroundBucket || "").trim();

const mainVideoUrl = mainVideoUrlRaw || await signReadUrlFromPath(mainPath, mainBucket);
const backgroundVideoUrl = backgroundVideoUrlRaw || await signReadUrlFromPath(backgroundPath, backgroundBucket);


    // 1) Load template JSON
    const template = await fetchTemplateJson(TEMPLATE_ID);
    const elements = Array.isArray(template.elements) ? template.elements : [];

    // 2) Find required input_video
    const mainEl = elements.find((e) => String(e.name || "") === "input_video");
    if (!mainEl) return res.status(500).json({ error: "Template missing required element named 'input_video'" });

    // 3) Ensure bg_video exists
    let bgEl = elements.find((e) => String(e.name || "") === "bg_video");
    if (!bgEl) {
      bgEl = {
        id: `bg_${Date.now()}`,
        name: "bg_video",
        type: "video",
        track: 1,
        time: 0,
        width: "100%",
        height: "100%",
        x_alignment: "50%",
        y_alignment: "50%",
      };
      elements.unshift(bgEl);
      template.elements = elements;
    }

    // 4) Set sources
    mainEl.source = mainVideoUrl;
    mainEl.src = mainVideoUrl;

    bgEl.source = backgroundVideoUrl;
    bgEl.src = backgroundVideoUrl;

    // 5) Slot layout
    const rects = getSlotRects(layout, mainSlot);

    // Ensure layering: bg below main
    bgEl.track = 1;
    mainEl.track = 2;

    applyVideoSlot(bgEl, rects.bg, { muted: bgMuted, speed: bgSpeed });
    applyVideoSlot(mainEl, rects.main, { muted: false, speed: mainSpeed });

    // 6) Captions
    if (captionsEnabled) {
      if (!STYLE_PRESETS[captionStyle]) {
        return res.status(400).json({ error: `Unknown caption style: ${captionStyle}` });
      }
      applyCaptions(template, captionStyle, captionOverrides, 1080, 1920);
    } else {
      for (const el of template.elements || []) {
        const name = String(el.name || "");
        if (name.startsWith("Subtitles_")) el.visible = false;
      }
    }

    // 7) Render
    const renderId = await createRenderFromTemplate(template);

    return res.status(200).json({ renderId });
  } catch (err) {
    return res.status(500).json({
      error: err && err.message ? err.message : "Unknown error",
    });
  }
};
