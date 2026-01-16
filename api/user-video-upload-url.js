// api/user-video-upload-url.js (CommonJS, Node 18+)
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

async function readJson(req) {
  // Works reliably on Vercel Node serverless
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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function safeName(name) {
  return String(name || "video.mp4")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    // Preflight
    return json(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed" });
  }

  const body = await readJson(req);
  if (!body) return json(res, 400, { error: "Missing body" });
  if (body === "__INVALID__") return json(res, 400, { error: "Invalid JSON" });

  const { fileName, fileSize, contentType } = body;

  if (!fileName || !fileSize) {
    return json(res, 400, { error: "fileName and fileSize are required" });
  }

  // ✅ Server-only env vars
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ✅ bucket: env var first, fallback to your real bucket name
  const BUCKET =
    process.env.SUPABASE_UPLOAD_BUCKET ||
    process.env.USER_VIDEOS_BUCKET ||
    "user-uploads";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, {
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Path in bucket
  const safe = safeName(fileName);
  const ext = (safe.split(".").pop() || "mp4").toLowerCase();
  const base = safe.replace(/\.[^/.]+$/, "");
  const path = `uploads/${Date.now()}_${base}.${ext}`;

  // ✅ Create signed upload URL (client will PUT to signedUrl)
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    return json(res, 500, {
      error: "Failed to create signed upload URL",
      details: error?.message || null,
    });
  }

  // IMPORTANT: client uses PUT to signedUrl, so return signedUrl
  return json(res, 200, {
    bucket: BUCKET,
    path,
    signedUrl: data.signedUrl,
    contentType: contentType || "video/mp4",
  });
};
