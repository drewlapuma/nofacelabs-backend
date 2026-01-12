// api/user-video-caption.js (CommonJS, Node 18+)
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data || "{}");
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
            return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } catch (e) {
            return reject(new Error(`Bad JSON response: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data || "{}");
            if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
            return reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } catch (e) {
            return reject(new Error(`Bad JSON response: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * ✅ Plug in your existing caption style logic here.
 * Return ONLY Creatomate text element properties (besides transcript_source).
 *
 * Creatomate auto-captions use:
 * - type: "text"
 * - transcript_source: "<video-element-id>"
 * - transcript_effect: e.g. "highlight" (and other options)
 * - plus styling like font, stroke, background, etc. :contentReference[oaicite:3]{index=3}
 */
function mapCaptionStyleToCreatomateProps(captionStyle, settings) {
  const s = String(captionStyle || "").toLowerCase();
  const cfg = settings || {};

  // Common base (use your defaults)
  const base = {
    // positioning (your modal probably stores x/y as percentages)
    x: cfg.x ?? "50%",
    y: cfg.y ?? "82%",
    width: cfg.width ?? "81%",
    height: cfg.height ?? "35%",
    x_alignment: cfg.x_alignment ?? "50%",
    y_alignment: cfg.y_alignment ?? "50%",

    font_family: cfg.font_family ?? "Montserrat",
    font_weight: cfg.font_weight ?? "800",
    font_size: cfg.font_size ?? "9 vmin",

    fill_color: cfg.fill_color ?? "#ffffff",
    stroke_color: cfg.stroke_color ?? "#000000",
    stroke_width: cfg.stroke_width ?? "1.6 vmin",

    // auto-caption behavior
    transcript_maximum_length: cfg.transcript_maximum_length ?? 14,
  };

  // Example style mapping (replace with your real ones)
  if (s === "karaoke") {
    return {
      ...base,
      transcript_effect: "karaoke",
      // You likely use active/highlight color in some styles:
      // (keep using your existing rules)
      background_color: "rgba(0,0,0,0)",
    };
  }

  if (s === "blackbar") {
    return {
      ...base,
      transcript_effect: "highlight",
      background_color: cfg.background_color ?? "rgba(0,0,0,0.65)",
      background_x_padding: cfg.background_x_padding ?? "10%",
      background_y_padding: cfg.background_y_padding ?? "12%",
      background_border_radius: cfg.background_border_radius ?? "10%",
      // note: your UI swaps Stroke->Background in blackbar; honor that here
      stroke_width: "0 vmin",
    };
  }

  // Default “highlight” style from Creatomate example :contentReference[oaicite:4]{index=4}
  return {
    ...base,
    transcript_effect: "highlight",
    background_color: cfg.background_color ?? "rgba(216,216,216,0)",
    background_x_padding: cfg.background_x_padding ?? "31%",
    background_y_padding: cfg.background_y_padding ?? "17%",
    background_border_radius: cfg.background_border_radius ?? "31%",
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET;
  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BUCKET || !CREATOMATE_API_KEY) {
    return json(res, 500, { error: "Missing env vars" });
  }

  let body;
  try {
    body = JSON.parse(req.body || "{}");
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const { path, width, height, captionStyle, captionSettings } = body;

  if (!path || !width || !height) {
    return json(res, 400, { error: "path, width, height required" });
  }

  // Create a signed URL so Creatomate can fetch the uploaded video
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 6 hours is usually enough for rendering
  const { data: signed, error: signedErr } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 6);

  if (signedErr || !signed?.signedUrl) {
    return json(res, 500, { error: "CREATE_SIGNED_URL_FAILED", details: signedErr?.message });
  }

  const videoId = "input-video";

  // Build Creatomate RenderScript payload with auto-captions
  // (uses transcript_source on the text element) :contentReference[oaicite:5]{index=5}
  const textProps = mapCaptionStyleToCreatomateProps(captionStyle, captionSettings);

  const payload = {
    output_format: "mp4",
    source: {
      width: Number(width),
      height: Number(height),
      elements: [
        {
          type: "video",
          id: videoId,
          source: signed.signedUrl,
        },
        {
          type: "text",
          transcript_source: videoId,
          ...textProps,
        },
      ],
    },
  };

  try {
    const render = await postJson(
      "https://api.creatomate.com/v1/renders",
      payload,
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` }
    );

    // Creatomate returns a render object (or array in some cases). Normalize:
    const item = Array.isArray(render) ? render[0] : render;

    return json(res, 200, {
      renderId: item?.id,
      status: item?.status,
      // sometimes url is only present when completed
      url: item?.url || null,
    });
  } catch (e) {
    return json(res, 500, { error: "CREATOMATE_RENDER_FAILED", details: String(e.message || e) });
  }
};
