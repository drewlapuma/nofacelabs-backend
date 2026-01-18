// api/user-video-caption.js (CommonJS, Node 18+)
// POST { path, width, height, captionStyle, captionSettings }
// Returns { renderId }

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

          if (res.statusCode >= 200 && res.statusCode < 300) {
            return resolve(parsed || {});
          }
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

// Map UI captionStyle -> your Creatomate subtitle element IDs
// These MUST match the IDs shown in the left panel in Creatomate.
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
  return String(s || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, ""); // "Bold White" -> "boldwhite"
}

function safeNum(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });

  const body = await readJson(req);
  if (!body) return sendJson(res, 400, { error: "Missing body" });
  if (body === "__INVALID__") return sendJson(res, 400, { error: "Invalid JSON" });

  const { path, width, height, captionStyle, captionSettings } = body;

  if (!path || !width || !height) {
    return sendJson(res, 400, { error: "path, width, height are required" });
  }

  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  const TEMPLATE_ID = process.env.CREATOMATE_CAPTION_TEMPLATE_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const BUCKET = process.env.USER_VIDEOS_BUCKET || "user-uploads";

  if (!CREATOMATE_API_KEY) return sendJson(res, 500, { error: "Missing CREATOMATE_API_KEY env var" });
  if (!TEMPLATE_ID) return sendJson(res, 500, { error: "Missing CREATOMATE_CAPTION_TEMPLATE_ID env var" });
  if (!SUPABASE_URL) return sendJson(res, 500, { error: "Missing SUPABASE_URL env var" });

  // IMPORTANT:
  // This works only if the bucket/path is publicly readable.
  // If your bucket is private, you must generate a signed GET URL server-side instead.
  const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  // Choose which subtitle layer to show
  const styleKey = normalizeStyleKey(captionStyle);
  const chosenLayer = STYLE_TO_LAYER[styleKey] || STYLE_TO_LAYER["sentence"];

  // Base modifications:
  // 1) swap the video source
  // 2) set template size to match video (optional but usually good)
  // 3) hide all subtitle layers, then show chosen
  const modifications = {
    "input_video.source": videoUrl,

    // Optional: if your template canvas is “Auto” you may not need these,
    // but it’s useful if you want output to match uploaded dims:
    "template.width": safeNum(width, 720),
    "template.height": safeNum(height, 1280),
  };

  // Turn all subtitle layers OFF
  for (const id of ALL_SUBTITLE_LAYERS) {
    modifications[`${id}.visible`] = false;
  }
  // Turn chosen one ON
  modifications[`${chosenLayer}.visible`] = true;

  // Optional: apply shared settings (if you store x/y/size in captionSettings)
  // These property paths must match Creatomate’s properties for that element.
  // If a key doesn’t exist, Creatomate will usually ignore it.
  const cs = captionSettings && typeof captionSettings === "object" ? captionSettings : {};

  // If you use normalized x/y positions (0-100), you can map them like this:
  if (cs.x !== undefined) modifications[`${chosenLayer}.x`] = safeNum(cs.x, 50);
  if (cs.y !== undefined) modifications[`${chosenLayer}.y`] = safeNum(cs.y, 90);

  // If you want font size adjustments:
  if (cs.size !== undefined) modifications[`${chosenLayer}.text_style.font_size`] = safeNum(cs.size, 70);

  // If you want fill/stroke/bg/shadow:
  if (cs.fill) modifications[`${chosenLayer}.text_style.fill_color`] = String(cs.fill);
  if (cs.stroke) modifications[`${chosenLayer}.text_style.stroke_color`] = String(cs.stroke);
  if (cs.background) modifications[`${chosenLayer}.text_style.background_color`] = String(cs.background);
  if (cs.shadow) modifications[`${chosenLayer}.text_style.shadow_color`] = String(cs.shadow);

  try {
    const renderResp = await httpJson(
      "POST",
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
      {
        template_id: TEMPLATE_ID,
        modifications,
      }
    );

    // Creatomate sometimes returns an array, sometimes an object depending on account/endpoint behavior
    const renderId = Array.isArray(renderResp) ? renderResp?.[0]?.id : renderResp?.id;

    if (!renderId) {
      return sendJson(res, 500, {
        error: "Missing renderId from Creatomate",
        debug: renderResp,
      });
    }

    return sendJson(res, 200, { renderId });
  } catch (err) {
    return sendJson(res, 500, { error: err?.message || "CREATOMATE_RENDER_FAILED" });
  }
};
