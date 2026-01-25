// api/composite.js (CommonJS, Node 18 on Vercel)
//
// POST /api/composite
// Body:
// {
//   mainVideoUrl: "https://...mp4",
//   backgroundVideoUrl: "https://...mp4",
//   layout: "sideBySide" | "topBottom",
//   mainSlot: "left"|"right"|"top"|"bottom",
//   mainSpeed: 1.0,
//   bgSpeed: 1.25,
//   captions: {
//     enabled: true,
//     style: "karaoke"|"sentence"|...,
//     settings: { x:50, y:82, fontSize:48, fillColor:"#fff", strokeWidth:8.1, strokeColor:"#000", activeColor:"#00FF49", fontFamily:"...", fontWeight:700 }
//   }
// }
//
// Returns: { renderId }

const https = require("https");

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

  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// ---------- Your caption presets ----------
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

// Which transcript effect to use per style
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

// Your template element names look like: Subtitles_RedTag, Subtitles_Karaoke, etc.
// Map style key -> exact element name in your template
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
    const req = https.request(
      { method, hostname, path, headers },
      (res) => {
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
            reject(
              new Error(
                `HTTP ${res.statusCode} ${method} ${path} :: ${raw || "no body"}`
              )
            );
          }
        });
      }
    );
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

// Template uses vmin strings (matches your screenshot)
function pxToVmin(px, canvasW = 1080, canvasH = 1920) {
  const vminPx = Math.min(canvasW, canvasH) / 100; // 10.8 for 1080x1920
  return Number(px) / vminPx;
}

// snap to simple steps
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
    transcript_color: merged.activeColor, // ✅ active highlight color
    transcript_source: "input_video",
    dynamic: true,
  };

  // Keep your existing blackbar look (don’t change)
  if (styleKey === "blackbar") {
    props.background_color = merged.backgroundColor || "#000000";
  }

  // Keep neonglow look (shadow color)
  if (styleKey === "neonglow") {
    props.shadow_color = merged.shadowColor || "#00D9FF";
  }

  // Remove undefined keys so we don’t accidentally overwrite template defaults
  Object.keys(props).forEach((k) => props[k] === undefined && delete props[k]);

  return props;
}

function getSlotRects(layout, mainSlot) {
  // returns { main: {x,y,w,h}, bg: {x,y,w,h} } in percent numbers (center-based)
  if (layout === "topBottom") {
    if (mainSlot === "bottom") {
      return {
        main: { x: 50, y: 75, w: 100, h: 50 },
        bg: { x: 50, y: 25, w: 100, h: 50 },
      };
    }
    // default main top
    return {
      main: { x: 50, y: 25, w: 100, h: 50 },
      bg: { x: 50, y: 75, w: 100, h: 50 },
    };
  }

  // sideBySide default
  if (mainSlot === "right") {
    return {
      main: { x: 75, y: 50, w: 50, h: 100 },
      bg: { x: 25, y: 50, w: 50, h: 100 },
    };
  }
  // default main left
  return {
    main: { x: 25, y: 50, w: 50, h: 100 },
    bg: { x: 75, y: 50, w: 50, h: 100 },
  };
}

function applyVideoSlot(el, rect, { muted, speed }) {
  // These field names are common in Creatomate templates:
  // - x/y alignment: x_alignment/y_alignment (center based)
  // - size: width/height
  // - audio: volume or muted
  // - speed: playback_rate
  el.x_alignment = toPercentString(rect.x);
  el.y_alignment = toPercentString(rect.y);
  el.width = `${rect.w}%`;
  el.height = `${rect.h}%`;

  // Fill slot (cropped). Depending on your template, this may be "fit": "cover".
  // We set it only if your element supports it—otherwise your sizing already forces crop.
  if (el.fit) el.fit = "cover";
  if (el.scale_mode) el.scale_mode = "cover";

  // Speed
  el.playback_rate = speed;

  // Background muted always
  if (muted) {
    // Try both (harmless if one is ignored)
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

// ---------- Creatomate ----------
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID_COMPOSITE;

// You can keep 9:16 fixed for now
const CANVAS_W = 1080;
const CANVAS_H = 1920;

async function fetchTemplateJson(templateId) {
  // Creatomate Templates API returns template object, including "template" or "source".
  // We defensively check common shapes.
  const data = await httpsJson({
    method: "GET",
    hostname: "api.creatomate.com",
    path: `/v1/templates/${encodeURIComponent(templateId)}`,
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  // Possible shapes:
  // data.template (object) OR data.source (object/string) OR data (object itself)
  if (data && typeof data.template === "object") return data.template;
  if (data && typeof data.source === "object") return data.source;
  if (data && typeof data === "object" && data.elements) return data;

  throw new Error("Could not read template JSON from Creatomate response.");
}

async function createRenderFromTemplate(templateObj) {
  // Creatomate renders endpoint commonly accepts { template: {...} } or { source: {...} }
  // We send both keys in a safe way (Creatomate will ignore unknown).
  const body = {
    template: templateObj,
    source: templateObj,
  };

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

  // Often returns { id: "...", status: "..." }
  const renderId = data && (data.id || data.render_id || data.renderId);
  if (!renderId) throw new Error(`Creatomate render response missing id: ${JSON.stringify(data)}`);
  return renderId;
}

// ---------- handler ----------
module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!CREATOMATE_API_KEY) return res.status(500).json({ error: "Missing CREATOMATE_API_KEY" });
    if (!TEMPLATE_ID) return res.status(500).json({ error: "Missing CREATOMATE_TEMPLATE_ID_COMPOSITE" });

    const body = await readJson(req);

    const mainVideoUrl = String(body.mainVideoUrl || "").trim();
    const backgroundVideoUrl = String(body.backgroundVideoUrl || "").trim();
    const layout = (body.layout === "topBottom" ? "topBottom" : "sideBySide");
    const mainSlot = String(body.mainSlot || (layout === "topBottom" ? "top" : "left")).toLowerCase();

    if (!mainVideoUrl) return res.status(400).json({ error: "mainVideoUrl required" });
    if (!backgroundVideoUrl) return res.status(400).json({ error: "backgroundVideoUrl required" });

    const mainSpeed = snapSpeed(body.mainSpeed);
    const bgSpeed = snapSpeed(body.bgSpeed);

    const captions = body.captions || {};
    const captionsEnabled = !!captions.enabled;
    const captionStyle = String(captions.style || "sentence").toLowerCase();
    const captionOverrides = captions.settings && typeof captions.settings === "object" ? captions.settings : {};

    // 1) Load template JSON from Creatomate
    const template = await fetchTemplateJson(TEMPLATE_ID);

    // 2) Locate input_video element (main) and bg_video (create if missing)
    const elements = Array.isArray(template.elements) ? template.elements : [];
    const mainEl = elements.find((e) => String(e.name || "") === "input_video");
    if (!mainEl) {
      return res.status(500).json({ error: "Template missing required element named 'input_video'" });
    }

    let bgEl = elements.find((e) => String(e.name || "") === "bg_video");
    if (!bgEl) {
      // Create a background video element similar to input_video
      bgEl = {
        id: `bg_${Date.now()}`,
        name: "bg_video",
        type: "video",
        track: 1,
        time: 0,
        // default sizing (we overwrite below)
        width: "100%",
        height: "100%",
        x_alignment: "50%",
        y_alignment: "50%",
      };
      // Insert bg under main
      elements.unshift(bgEl);
      template.elements = elements;
    }

    // 3) Set sources
    mainEl.source = mainVideoUrl;
    mainEl.src = mainVideoUrl;
    bgEl.source = backgroundVideoUrl;
    bgEl.src = backgroundVideoUrl;

    // 4) Slot math (fill/crop)
    const rects = getSlotRects(layout, mainSlot);

    // Ensure layering: bg below main
    bgEl.track = 1;
    mainEl.track = 2;

    applyVideoSlot(bgEl, rects.bg, { muted: true, speed: bgSpeed });
    applyVideoSlot(mainEl, rects.main, { muted: false, speed: mainSpeed });

    // 5) Captions: turn on exactly one Subtitles_* layer, apply settings
    if (captionsEnabled) {
      if (!STYLE_PRESETS[captionStyle]) {
        return res.status(400).json({ error: `Unknown caption style: ${captionStyle}` });
      }
      applyCaptions(template, captionStyle, captionOverrides, CANVAS_W, CANVAS_H);
    } else {
      // Hide all subtitle layers
      for (const el of template.elements || []) {
        const name = String(el.name || "");
        if (name.startsWith("Subtitles_")) el.visible = false;
      }
    }

    // 6) Render
    const renderId = await createRenderFromTemplate(template);

    return res.status(200).json({ renderId });
  } catch (err) {
    return res.status(500).json({
      error: err && err.message ? err.message : "Unknown error",
    });
  }
};
