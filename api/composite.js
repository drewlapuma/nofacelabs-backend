// api/composite.js (CommonJS, Node 18 on Vercel)
//
// POST /api/composite
// Body (JSON):
// {
//   mainPath: "uploads/....mp4"            // OR mainVideoUrl
//   backgroundPath: "uploads/....mp4"      // OR backgroundVideoUrl
//   backgroundVideoUrl: "https://...mp4"   // optional
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
// GET /api/composite?id=RENDER_ID
// Returns { ok:true, status, url?, renderId }
//
// Env:
// - CREATOMATE_API_KEY
// - CREATOMATE_TEMPLATE_ID_COMPOSITE
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - SUPABASE_UPLOAD_BUCKET (or USER_VIDEOS_BUCKET) default "user-uploads"

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

// ---------- CORS ----------
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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

// ---------- helpers ----------
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
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (_) {}

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

// snap to your pills
const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function snapSpeed(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  let best = SPEED_STEPS[0];
  let bestD = Infinity;
  for (const s of SPEED_STEPS) {
    const d = Math.abs(s - n);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

// Template uses vmin strings (matches your setup)
function pxToVmin(px, canvasW = 1080, canvasH = 1920) {
  const vminPx = Math.min(canvasW, canvasH) / 100; // 10.8 for 1080x1920
  return Number(px) / vminPx;
}

// ---------- caption presets ----------
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

function buildSubtitleProps(styleKey, overrides = {}, canvasW = 1080, canvasH = 1920) {
  const preset = STYLE_PRESETS[styleKey] || {};
  const merged = { ...BASE_DEFAULTS, ...preset, ...overrides };

  const effect = EFFECT_MAP[styleKey] || "sentence";

  const fontSizeVmin = pxToVmin(merged.fontSize, canvasW, canvasH);
  const strokeVmin = pxToVmin(merged.strokeWidth, canvasW, canvasH);

  const props = {
    x_alignment: toPercentString(merged.x),
    y_alignment: toPercentString(merged.y),
    width: merged.width ? String(merged.width) : undefined,
    height: merged.height ? String(merged.height) : undefined,

    font_family: merged.fontFamily,
    font_weight: String(merged.fontWeight ?? 400),

    font_size: `${fontSizeVmin.toFixed(2)} vmin`,
    fill_color: merged.fillColor,
    stroke_color: merged.strokeColor,
    stroke_width: `${strokeVmin.toFixed(2)} vmin`,

    transcript_effect: effect,
    transcript_color: merged.activeColor,
    transcript_source: "input_video",
    dynamic: true,
  };

  if (styleKey === "blackbar") props.background_color = merged.backgroundColor || "#000000";
  if (styleKey === "neonglow") props.shadow_color = merged.shadowColor || "#00D9FF";

  Object.keys(props).forEach((k) => props[k] === undefined && delete props[k]);
  return props;
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

function getSlotRects(layout, mainSlot) {
  if (layout === "topBottom") {
    if (mainSlot === "bottom") {
      return {
        main: { x: 50, y: 75, w: 100, h: 50 },
        bg: { x: 50, y: 25, w: 100, h: 50 },
      };
    }
    return {
      main: { x: 50, y: 25, w: 100, h: 50 },
      bg: { x: 50, y: 75, w: 100, h: 50 },
    };
  }

  if (mainSlot === "right") {
    return {
      main: { x: 75, y: 50, w: 50, h: 100 },
      bg: { x: 25, y: 50, w: 50, h: 100 },
    };
  }

  return {
    main: { x: 25, y: 50, w: 50, h: 100 },
    bg: { x: 75, y: 50, w: 50, h: 100 },
  };
}

function applyVideoSlot(el, rect, { muted, speed }) {
  el.x_alignment = toPercentString(rect.x);
  el.y_alignment = toPercentString(rect.y);
  el.width = `${rect.w}%`;
  el.height = `${rect.h}%`;

  if (el.fit) el.fit = "cover";
  if (el.scale_mode) el.scale_mode = "cover";

  el.playback_rate = speed;

  if (muted) {
    el.volume = 0;
    el.muted = true;
  }
}

// ---------- Supabase signed READ urls ----------
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

function getBucketName() {
  return (
    process.env.SUPABASE_UPLOAD_BUCKET ||
    process.env.USER_VIDEOS_BUCKET ||
    "user-uploads"
  );
}

async function signedReadUrlForPath(path, expiresInSeconds = 60 * 30) {
  const supabase = getSupabaseAdmin();
  const bucket = getBucketName();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(`Signed read URL error: ${error?.message || "unknown"} (path=${path})`);
  }

  return data.signedUrl;
}

// ---------- Creatomate ----------
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID_COMPOSITE;

const CANVAS_W = 1080;
const CANVAS_H = 1920;

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

// ✅ FIX: Creatomate can return an array of renders
function normalizeCreatomateRenderResponse(resp) {
  const first = Array.isArray(resp) ? resp[0] : resp;
  const renderId = first && (first.id || first.render_id || first.renderId);
  const status = first && (first.status || first.state);
  const url = first && (first.url || first.download_url || first.downloadUrl || first.output_url || first.outputUrl);

  return { renderId, status, url, first };
}

async function createRenderFromTemplate(templateObj) {
  const body = {
    template: templateObj,
    source: templateObj,
  };

  const resp = await httpsJson({
    method: "POST",
    hostname: "api.creatomate.com",
    path: "/v1/renders",
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });

  const norm = normalizeCreatomateRenderResponse(resp);
  if (!norm.renderId) {
    throw new Error(`Creatomate render response missing id: ${JSON.stringify(resp)}`);
  }
  return { renderId: norm.renderId, status: norm.status, url: norm.url };
}

async function fetchRenderStatus(renderId) {
  const resp = await httpsJson({
    method: "GET",
    hostname: "api.creatomate.com",
    path: `/v1/renders/${encodeURIComponent(renderId)}`,
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const norm = normalizeCreatomateRenderResponse(resp);
  // For GET, Creatomate usually returns object (not array), but normalize is safe.
  return { status: norm.status || resp?.status, url: norm.url || resp?.url, raw: resp };
}

// ---------- handler ----------
module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  try {
    if (!CREATOMATE_API_KEY) return json(res, 500, { ok: false, error: "Missing CREATOMATE_API_KEY" });
    if (!TEMPLATE_ID) return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_COMPOSITE" });

    // -------- GET: poll render --------
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const s = await fetchRenderStatus(id);
      return json(res, 200, {
        ok: true,
        renderId: id,
        status: s.status || "unknown",
        url: s.url || null,
      });
    }

    // -------- POST: create render --------
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    const body = await readJson(req);

    const layout = (body.layout === "topBottom" ? "topBottom" : "sideBySide");
    const mainSlot = String(body.mainSlot || (layout === "topBottom" ? "top" : "left")).toLowerCase();

    const mainSpeed = snapSpeed(body.mainSpeed);
    const bgSpeed = snapSpeed(body.bgSpeed);
    const bgMuted = body.bgMuted !== false; // default true

    // main source: path preferred, else url
    const mainPath = String(body.mainPath || "").trim();
    const mainVideoUrlRaw = String(body.mainVideoUrl || "").trim();

    // background source: path preferred, else url
    const bgPath = String(body.backgroundPath || "").trim();
    const backgroundVideoUrlRaw = String(body.backgroundVideoUrl || "").trim();

    if (!mainPath && !mainVideoUrlRaw) return json(res, 400, { ok: false, error: "mainPath or mainVideoUrl required" });
    if (!bgPath && !backgroundVideoUrlRaw) return json(res, 400, { ok: false, error: "backgroundPath or backgroundVideoUrl required" });

    // ✅ Convert paths -> signed READ urls (so Creatomate can fetch them)
    const mainVideoUrl = mainPath ? await signedReadUrlForPath(mainPath) : mainVideoUrlRaw;
    const backgroundVideoUrl = bgPath ? await signedReadUrlForPath(bgPath) : backgroundVideoUrlRaw;

    const captions = body.captions || {};
    const captionsEnabled = captions.enabled !== false; // default on if you send captions object
    const captionStyle = String(captions.style || "sentence").toLowerCase();
    const captionOverrides = (captions.settings && typeof captions.settings === "object") ? captions.settings : {};

    // 1) Load template JSON
    const template = await fetchTemplateJson(TEMPLATE_ID);

    // 2) Elements
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const mainEl = elements.find((e) => String(e.name || "") === "input_video");
    if (!mainEl) return json(res, 500, { ok: false, error: "Template missing required element named 'input_video'" });

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

    // 3) Set sources
    mainEl.source = mainVideoUrl;
    mainEl.src = mainVideoUrl;
    bgEl.source = backgroundVideoUrl;
    bgEl.src = backgroundVideoUrl;

    // 4) Slot layout
    const rects = getSlotRects(layout, mainSlot);

    bgEl.track = 1;
    mainEl.track = 2;

    applyVideoSlot(bgEl, rects.bg, { muted: bgMuted, speed: bgSpeed });
    applyVideoSlot(mainEl, rects.main, { muted: false, speed: mainSpeed });

    // 5) Captions
    if (captionsEnabled) {
      if (!STYLE_PRESETS[captionStyle]) {
        return json(res, 400, { ok: false, error: `Unknown caption style: ${captionStyle}` });
      }
      applyCaptions(template, captionStyle, captionOverrides, CANVAS_W, CANVAS_H);
    } else {
      for (const el of template.elements || []) {
        const name = String(el.name || "");
        if (name.startsWith("Subtitles_")) el.visible = false;
      }
    }

    // 6) Render
    const out = await createRenderFromTemplate(template);

    return json(res, 200, {
      ok: true,
      renderId: out.renderId,
      status: out.status || "planned",
      url: out.url || null,
    });
  } catch (err) {
    return json(res, 500, {
      ok: false,
      error: err && err.message ? err.message : "Unknown error",
    });
  }
};
