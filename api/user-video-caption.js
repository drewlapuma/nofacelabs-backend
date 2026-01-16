// api/user-video-caption.js
const https = require("https");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",").map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOW_ORIGINS.includes(origin)) {
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

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return "__INVALID__"; }
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
          ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch {}
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed || {});
          return reject(new Error(parsed?.error || parsed?.message || data || ("HTTP " + res.statusCode)));
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const body = await readJson(req);
  if (!body) return json(res, 400, { error: "Missing body" });
  if (body === "__INVALID__") return json(res, 400, { error: "Invalid JSON" });

  const { path, width, height, captionStyle, captionSettings } = body;

  if (!path || !width || !height) {
    return json(res, 400, { error: "path, width, height are required" });
  }

  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  const CREATOMATE_TEMPLATE_ID = process.env.CREATOMATE_CAPTION_TEMPLATE_ID; // make a template for “user upload captions”
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const BUCKET = process.env.USER_VIDEOS_BUCKET || "user-uploads";

  if (!CREATOMATE_API_KEY) return json(res, 500, { error: "Missing CREATOMATE_API_KEY env var" });
  if (!CREATOMATE_TEMPLATE_ID) return json(res, 500, { error: "Missing CREATOMATE_CAPTION_TEMPLATE_ID env var" });
  if (!SUPABASE_URL) return json(res, 500, { error: "Missing SUPABASE_URL env var" });

  // Public URL to the uploaded video (bucket must be public OR you must sign it server-side)
  const videoUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  // TODO: map captionStyle/captionSettings into your template variables exactly
  // These keys MUST match your Creatomate template “Modifications” names.
  const modifications = {
    video: videoUrl,
    captionStyle: captionStyle || "sentence",
    captionSettings: JSON.stringify(captionSettings || {}),
  };

  try {
    const render = await httpJson(
      "POST",
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
      {
        template_id: CREATOMATE_TEMPLATE_ID,
        modifications,
      }
    );

    // Creatomate can return either an object or array depending on endpoint usage
    const renderId = Array.isArray(render) ? render?.[0]?.id : render?.id;

    if (!renderId) {
      return json(res, 500, { error: "Missing renderId from Creatomate", debug: render });
    }

    return json(res, 200, { renderId });
  } catch (err) {
    return json(res, 500, { error: err.message || "CREATOMATE_RENDER_FAILED" });
  }
};
