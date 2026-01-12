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

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function safeExt(filename) {
  const m = String(filename || "").toLowerCase().match(/\.(mp4|mov|m4v|webm)$/);
  return m ? m[1] : "mp4";
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BUCKET = process.env.SUPABASE_UPLOAD_BUCKET;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BUCKET) {
    return json(res, 500, { error: "Missing Supabase env vars" });
  }

  let body;
  try {
    body = JSON.parse(req.body || "{}");
  } catch {
    return json(res, 400, { error: "Invalid JSON" });
  }

  const fileName = body.fileName;
  const fileSize = Number(body.fileSize || 0);
  const contentType = body.contentType || "video/mp4";

  if (!fileName || !fileSize) {
    return json(res, 400, { error: "fileName and fileSize required" });
  }

  // (Optional) basic size guard
  // if (fileSize > 1024 * 1024 * 500) return json(res, 400, { error: "File too large" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const ext = safeExt(fileName);
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `user-videos/${id}.${ext}`;

  // Signed upload URL (valid ~2 hours per Supabase docs) :contentReference[oaicite:1]{index=1}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);

  if (error || !data?.signedUrl || !data?.token) {
    return json(res, 500, { error: "CREATE_SIGNED_UPLOAD_URL_FAILED", details: error?.message });
  }

  return json(res, 200, {
    bucket: BUCKET,
    path,
    signedUrl: data.signedUrl,
    token: data.token,
    contentType,
  });
};
