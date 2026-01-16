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
  // Some Vercel setups don’t populate req.body for raw functions reliably.
  // This works every time.
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

function safeName(name) {
  return String(name || "video.mp4")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = await readJson(req);
  if (!body) return res.status(400).json({ error: "Missing body" });
  if (body === "__INVALID__") return res.status(400).json({ error: "Invalid JSON" });

  const { fileName, fileSize, contentType } = body;

  if (!fileName || !fileSize) {
    return res.status(400).json({ error: "fileName and fileSize are required" });
  }

  // ✅ Supabase service role (server only)
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BUCKET = process.env.USER_VIDEOS_BUCKET || "user-videos";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars" });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // You should use a real member id here (Memberstack / session).
  // For now, a simple timestamp-based path:
  const ext = safeName(fileName).split(".").pop() || "mp4";
  const base = safeName(fileName).replace(/\.[^/.]+$/, "");
  const path = `uploads/${Date.now()}_${base}.${ext}`;

  // Create a signed upload URL token (client uses uploadToSignedUrl)
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    return res.status(500).json({ error: error?.message || "Failed to create signed upload URL" });
  }

  return res.status(200).json({
    bucket: BUCKET,
    path,
    token: data.token,
    // optional debugging:
    // signedUrl: data.signedUrl
  });
};
