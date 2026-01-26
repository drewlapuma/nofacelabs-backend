// api/composite.js (CommonJS, Node 18+ on Vercel)
//
// ✅ What this version fixes:
// - Works WITHOUT Memberstack JWT (no more "Please log in" gate at all)
// - Uses your existing signed PUT upload flow paths (mainPath/backgroundPath)
// - Creates SIGNED READ URLs from Supabase Storage paths (so Creatomate can fetch videos)
// - Fixes Creatomate 400 by mapping transcript_effect to allowed values only
// - Handles Creatomate returning an ARRAY (bulk) or an OBJECT (single)
// - Supports GET /api/composite?id=... polling
// - Positions input_video + bg-video based on layout + mainSlot
// - Toggles the correct subtitle layer based on caption style
//
// Required env vars:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - CREATOMATE_API_KEY
// - CREATOMATE_TEMPLATE_ID   (your "Upload captioned" template id)
//
// Optional env vars:
// - SUPABASE_UPLOAD_BUCKET or USER_VIDEOS_BUCKET (defaults to "user-uploads")
// - ALLOW_ORIGINS or ALLOW_ORIGIN (defaults "*")

const { createClient } = require("@supabase/supabase-js");
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

function clamp(n, a, b) {
  const v = Number(n);
  if (!Number.isFinite(v)) return a;
  return Math.max(a, Math.min(b, v));
}

function toPx(n, fallbackPx) {
  if (n == null) return fallbackPx;
  const v = Number(n);
  if (!Number.isFinite(v)) return fallbackPx;
  return Math.round(v) + "px";
}

function normalizeHex(c) {
  if (!c) return null;
  const s = String(c).trim();
  // accept #RRGGBB or #RGB
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

function httpJson(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);

    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          Accept: "application/json",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (d) => chunks.push(d));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let j = null;
          try {
            j = JSON.parse(text || "null");
          } catch {
            j = { raw: text };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j);
          const err = new Error(j?.error || j?.message || `HTTP ${res.statusCode}`);
          err.status = res.statusCode;
          err.payload = j;
          reject(err);
        });
      }
    );

    req.on("error", reject);

    if (bodyObj != null) {
      const s = JSON.stringify(bodyObj);
      req.setHeader("Content-Type", "application/json");
      req.setHeader("Content-Length", Buffer.byteLength(s));
      req.write(s);
    }

    req.end();
  });
}

/** ✅ Creatomate only allows these transcript_effect values */
function mapTranscriptEffect(captionStyleRaw) {
  const s = String(captionStyleRaw || "").trim().toLowerCase();

  // your UI styles that truly need effects:
  if (s.includes("karaoke")) return "karaoke";
  if (s.includes("highlight")) return "highlight";
  if (s.includes("highlighter")) return "highlight";
  if (s.includes("bounce")) return "bounce";
  if (s.includes("slide")) return "slide";
  if (s.includes("enlarge")) return "enlarge";
  if (s.includes("fade")) return "fade";

  // everything else should be SAFE:
  // sentence, word, redtag, yellowpop, minttag, blackbar, neonglow, purplepop, etc.
  return "color";
}

/** Map caption style -> one of YOUR layer names in the template */
function mapCaptionLayerName(captionStyleRaw) {
  const s = String(captionStyleRaw || "").trim().toLowerCase();

  // Common names from your UI
  if (s === "sentence" || s.includes("sentence")) return "Subtitles_Sentence";
  if (s === "word" || s.includes("word")) return "Subtitles_Word";
  if (s.includes("karaoke")) return "Subtitles_Karaoke";
  if (s.includes("boldwhite") || s.includes("bold white")) return "Subtitles_BoldWhite";
  if (s.includes("yellowpop") || s.includes("yellow")) return "Subtitles_YellowPop";
  if (s.includes("minttag") || s.includes("mint")) return "Subtitles_MintTag";
  if (s.includes("blackbar") || s.includes("black bar")) return "Subtitles_BlackBar";
  if (s.includes("highlighter")) return "Subtitles_Highlighter";
  if (s.includes("neonglow") || s.includes("neon")) return "Subtitles_NeonGlow";
  if (s.includes("purplepop") || s.includes("purple")) return "Subtitles_PurplePop";
  if (s.includes("compactlowerthird") || s.includes("lower third")) return "Subtitles_CompactLowerThird";
  if (s.includes("bouncepop") || s.includes("bounce pop")) return "Subtitles_BouncePop";
  if (s.includes("outlinepunch") || s.includes("outline")) return "Subtitles_OutlinePunch";
  if (s.includes("redtag") || s.includes("red")) return "Subtitles_RedTag";
  if (s.includes("redalert") || s.includes("red alert")) return "Subtitles_RedAlert";

  // fallback
  return "Subtitles_Sentence";
}

const ALL_SUBTITLE_LAYERS = [
  "Subtitles_Sentence",
  "Subtitles_Word",
  "Subtitles_Karaoke",
  "Subtitles_BoldWhite",
  "Subtitles_YellowPop",
  "Subtitles_MintTag",
  "Subtitles_BlackBar",
  "Subtitles_Highlighter",
  "Subtitles_NeonGlow",
  "Subtitles_PurplePop",
  "Subtitles_CompactLowerThird",
  "Subtitles_BouncePop",
  "Subtitles_OutlinePunch",
  "Subtitles_RedTag",
  "Subtitles_RedAlert",
];

// Build x/y/width/height for the two video layers based on layout & mainSlot
function computeLayout(layoutRaw, mainSlotRaw) {
  const layout = String(layoutRaw || "sideBySide");
  const slot = String(mainSlotRaw || (layout === "topBottom" ? "top" : "left"));

  // We will position using percent.
  // Creatomate uses x/y as center by default for many elements.
  // We'll set: width, height, x, y as percents.
  const full = { w: "100%", h: "100%" };

  if (layout === "topBottom") {
    const topRect = { w: "100%", h: "50%", x: "50%", y: "25%" };
    const botRect = { w: "100%", h: "50%", x: "50%", y: "75%" };

    const mainIsTop = slot === "top";
    return {
      main: mainIsTop ? topRect : botRect,
      bg: mainIsTop ? botRect : topRect,
    };
  }

  // sideBySide default
  const leftRect = { w: "50%", h: "100%", x: "25%", y: "50%" };
  const rightRect = { w: "50%", h: "100%", x: "75%", y: "50%" };

  const mainIsLeft = slot === "left";
  return {
    main: mainIsLeft ? leftRect : rightRect,
    bg: mainIsLeft ? rightRect : leftRect,
  };
}

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

async function createSignedReadUrl({ supabaseAdmin, bucket, path, expiresIn = 3600 }) {
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    const e = new Error("Signed read URL error: " + (error?.message || "Unknown"));
    e.details = error || null;
    throw e;
  }

  return data.signedUrl;
}

async function creatomateCreateRender({ apiKey, templateId, modifications }) {
  // Creatomate POST /v1/renders returns ARRAY when you pass an array, or may return array anyway depending usage.
  // We'll call it with a single object and still handle array response.
  const url = "https://api.creatomate.com/v1/renders";
  const body = {
    template_id: templateId,
    modifications,
    output_format: "mp4",
  };

  const res = await httpJson("POST", url, { Authorization: `Bearer ${apiKey}` }, body);
  return res;
}

async function creatomateGetRender({ apiKey, renderId }) {
  const url = `https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`;
  return await httpJson("GET", url, { Authorization: `Bearer ${apiKey}` }, null);
}

function extractRenderInfo(creatomateResponse) {
  // Handle:
  // - object: { id, status, url }
  // - array:  [ { id, status, url } ]
  const item = Array.isArray(creatomateResponse)
    ? (creatomateResponse[0] || null)
    : creatomateResponse;

  const id = item?.id || item?.render_id || item?.data?.id || null;
  const status = item?.status || item?.data?.status || null;
  const url = item?.url || item?.data?.url || item?.output || null;

  return { id, status, url, raw: creatomateResponse };
}

function buildSubtitleMods({ captionStyle, captionSettings }) {
  const activeLayer = mapCaptionLayerName(captionStyle);
  const transcriptEffect = mapTranscriptEffect(captionStyle);

  // Safely pull settings your UI might send
  const s = captionSettings && typeof captionSettings === "object" ? captionSettings : {};

  // common possible keys from your UI
  const fontFamily = s.font_family || s.fontFamily || null;
  const fontSize = s.font_size || s.fontSize || null;

  const fill = normalizeHex(s.fill || s.fill_color || s.fillColor);
  const stroke = normalizeHex(s.stroke || s.stroke_color || s.strokeColor);
  const strokeWidth = s.stroke_width ?? s.strokeWidth ?? null;

  const background = normalizeHex(s.background || s.background_color || s.backgroundColor);
  const shadow = normalizeHex(s.shadow || s.shadow_color || s.shadowColor);
  const shadowBlur = s.shadow_blur ?? s.shadowBlur ?? null;

  const x = s.x != null ? String(s.x) : null; // allow "50%" strings
  const y = s.y != null ? String(s.y) : null;

  // "activeColor" in your UI should map to transcript_color (used by karaoke/highlight styles)
  const activeColor = normalizeHex(s.activeColor || s.active_color || s.transcript_color || s.transcriptColor);

  // Build mods:
  // 1) Turn OFF all subtitle layers
  // 2) Turn ON active layer
  // 3) Apply transcript_effect (ALWAYS VALID)
  // 4) Apply basic typography/colors if present
  const mods = [];

  for (const layer of ALL_SUBTITLE_LAYERS) {
    mods.push({ name: layer, properties: { visible: layer === activeLayer } });
  }

  const activeProps = {
    // This is the field throwing your 400 when invalid:
    transcript_effect: transcriptEffect,

    // Keep transcript colors safe
    ...(activeColor ? { transcript_color: activeColor } : {}),

    // Position if you store percent strings in your UI
    ...(x ? { x } : {}),
    ...(y ? { y } : {}),

    // Typography
    ...(fontFamily ? { font_family: fontFamily } : {}),
    ...(fontSize != null ? { font_size: toPx(fontSize, "48px") } : {}),

    // Styling
    ...(fill ? { fill_color: fill } : {}),
    ...(stroke ? { stroke_color: stroke } : {}),
    ...(strokeWidth != null ? { stroke_width: toPx(strokeWidth, "6px") } : {}),

    ...(background ? { background_color: background } : {}),
    ...(shadow ? { shadow_color: shadow } : {}),
    ...(shadowBlur != null ? { shadow_blur: toPx(shadowBlur, "12px") } : {}),
  };

  // Ensure active layer gets these props
  mods.push({ name: activeLayer, properties: activeProps });

  return mods;
}

module.exports = async function handler(req, res) {
  try {
    setCors(req, res);

    if (req.method === "OPTIONS") return json(res, 200, { ok: true });

    const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
    const CREATOMATE_TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID;

    const BUCKET =
      process.env.SUPABASE_UPLOAD_BUCKET ||
      process.env.USER_VIDEOS_BUCKET ||
      "user-uploads";

    if (!CREATOMATE_API_KEY || !CREATOMATE_TEMPLATE_ID) {
      return json(res, 500, { ok: false, error: "Missing CREATOMATE_API_KEY or CREATOMATE_TEMPLATE_ID" });
    }

    // -----------------------
    // GET /api/composite?id=...
    // -----------------------
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateGetRender({ apiKey: CREATOMATE_API_KEY, renderId: id });

      const status = String(r?.status || "").toLowerCase();
      const url = r?.url || null;

      return json(res, 200, {
        ok: true,
        renderId: id,
        status: r?.status || null,
        url: status === "succeeded" ? url : null,
        error: status === "failed" ? (r?.error || r?.message || "Render failed") : null,
        raw: r,
      });
    }

    // -----------------------
    // POST /api/composite
    // -----------------------
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    const body = await readJson(req);
    if (!body) return json(res, 400, { ok: false, error: "Missing body" });
    if (body === "__INVALID__") return json(res, 400, { ok: false, error: "Invalid JSON" });

    const {
      mainPath,
      backgroundPath,
      backgroundVideoUrl,
      layout,
      mainSlot,
      mainSpeed,
      bgSpeed,
      bgMuted,
      captions,
    } = body || {};

    if (!mainPath) return json(res, 400, { ok: false, error: "Missing mainPath" });
    if (!backgroundPath && !backgroundVideoUrl) {
      return json(res, 400, { ok: false, error: "Missing backgroundPath or backgroundVideoUrl" });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Signed READ URLs so Creatomate can pull the files
    const mainUrl = await createSignedReadUrl({
      supabaseAdmin,
      bucket: BUCKET,
      path: String(mainPath),
      expiresIn: 3600,
    });

    let bgUrl = null;
    if (backgroundPath) {
      bgUrl = await createSignedReadUrl({
        supabaseAdmin,
        bucket: BUCKET,
        path: String(backgroundPath),
        expiresIn: 3600,
      });
    } else {
      bgUrl = String(backgroundVideoUrl);
    }

    // Layout rectangles
    const rects = computeLayout(layout, mainSlot);

    const ms = clamp(mainSpeed == null ? 1 : mainSpeed, 0.25, 3);
    const bs = clamp(bgSpeed == null ? 1 : bgSpeed, 0.25, 3);
    const muted = bgMuted === true || bgMuted === 1 || bgMuted === "1";

    // Caption config
    const captionsEnabled = captions?.enabled !== false; // default true
    const captionStyle = captions?.style || "sentence";
    const captionSettings = captions?.settings || {};

    // Build modifications for Creatomate template
    // Your template layers:
    // - input_video
    // - bg-video
    // - Subtitles_* (many layers)
    const modifications = [];

    // main video layer (input_video)
    modifications.push({
      name: "input_video",
      properties: {
        source: mainUrl,
        playback_rate: ms,
        volume: 1,
        ...rects.main,
      },
    });

    // background video layer (bg-video)
    modifications.push({
      name: "bg-video",
      properties: {
        source: bgUrl,
        playback_rate: bs,
        volume: muted ? 0 : 1,
        ...rects.bg,
      },
    });

    // Subtitles: toggle correct layer + set transcript_effect safely
    if (captionsEnabled) {
      modifications.push(...buildSubtitleMods({ captionStyle, captionSettings }));
    } else {
      // turn them all off
      for (const layer of ALL_SUBTITLE_LAYERS) {
        modifications.push({ name: layer, properties: { visible: false } });
      }
    }

    // Call Creatomate
    let created;
    try {
      created = await creatomateCreateRender({
        apiKey: CREATOMATE_API_KEY,
        templateId: CREATOMATE_TEMPLATE_ID,
        modifications,
      });
    } catch (e) {
      // Bubble up helpful details to your console/UI
      return json(res, 400, {
        ok: false,
        error: `Creatomate HTTP ${e.status || 400}`,
        details: e.payload || e.message || String(e),
      });
    }

    const info = extractRenderInfo(created);

    if (!info.id) {
      return json(res, 500, {
        ok: false,
        error: "Creatomate render response missing id",
        raw: info.raw,
      });
    }

    // If Creatomate already returned succeeded + url, pass it through;
    // otherwise your frontend will poll GET /api/composite?id=...
    return json(res, 200, {
      ok: true,
      renderId: info.id,
      status: info.status || "planned",
      url: info.status === "succeeded" ? info.url : null,
    });
  } catch (err) {
    console.error("[/api/composite] error:", err);
    return json(res, 500, { ok: false, error: err?.message || "Server error" });
  }
};
