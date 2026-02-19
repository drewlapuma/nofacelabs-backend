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

  // ✅ IMPORTANT: allow your Memberstack headers too (fixes your earlier CORS error)
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-nf-member-id, x-nf-member-email"
  );
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

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

  const body = await readJson(req);
  if (!body) return json(res, 400, { ok: false, error: "Missing body" });
  if (body === "__INVALID__") return json(res, 400, { ok: false, error: "Invalid JSON" });

  // ✅ accept both spellings (your JS might send either)
  const fileName = body.fileName || body.filename || body.name;
  const fileSize = body.fileSize || body.size;
  const contentType = body.contentType || body.type || "video/mp4";

  if (!fileName || !fileSize) {
    return json(res, 400, { ok: false, error: "fileName and fileSize are required" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const BUCKET =
    process.env.SUPABASE_UPLOAD_BUCKET ||
    process.env.USER_VIDEOS_BUCKET ||
    "user-uploads";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const safe = safeName(fileName);
  const ext = (safe.split(".").pop() || "mp4").toLowerCase();
  const base = safe.replace(/\.[^/.]+$/, "");
  const path = `uploads/${Date.now()}_${base}.${ext}`;

  // ✅ Signed upload URL (client will PUT to it)
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    return json(res, 500, {
      ok: false,
      error: "Failed to create signed upload URL",
      details: error?.message || null,
    });
  }

  // ✅ Public URL (works if bucket is public)
  let publicUrl = null;
  try {
    const pub = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    publicUrl = pub?.data?.publicUrl || null;
  } catch {
    publicUrl = null;
  }

  // ✅ Signed download URL fallback (works even if bucket is private)
  // Set long enough for rendering to complete (ex: 24 hours)
  let downloadUrl = null;
  try {
    const expiresIn = 60 * 60 * 24; // 24h
    const signedGet = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    downloadUrl = signedGet?.data?.signedUrl || null;
  } catch {
    downloadUrl = null;
  }

  return json(res, 200, {
    ok: true,
    bucket: BUCKET,
    path,

    // ✅ what the front-end uploader expects
    uploadUrl: data.signedUrl,

    // ✅ what your renderer should use as backgroundVideoUrl
    // Prefer publicUrl; fallback to downloadUrl for private buckets
    publicUrl: publicUrl || downloadUrl,

    // also include both explicitly (helpful for debugging)
    publicUrlRaw: publicUrl,
    downloadUrl,

    contentType,
  });
};
