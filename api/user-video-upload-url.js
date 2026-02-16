// api/user-video-upload-url.js (CommonJS, Node 18+)
// ✅ Signed upload URL for Supabase Storage (client PUTs to signedUrl)
// ✅ CORS updated to allow X-NF-Member-Id / X-NF-Member-Email (fixes your preflight error)
// ✅ NO JWT required: uses x-nf-member-id header to (optionally) scope uploads per user

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

  // ✅ FIX: allow your custom headers in preflight
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-NF-Member-Id, X-NF-Member-Email"
  );
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

// ✅ use header member id (no JWT)
function getMemberId(req) {
  const id = String(req.headers["x-nf-member-id"] || "").trim();
  return id || "";
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
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

  // ✅ Optional: enforce "logged in" via header
  // If you want uploads to be allowed even for logged-out users, delete this block.
  const memberId = getMemberId(req);
  if (!memberId) {
    return json(res, 401, {
      error: "MISSING_MEMBER_ID",
      message: "Missing x-nf-member-id header",
    });
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

  // Path in bucket (scoped per member)
  const safe = safeName(fileName);
  const ext = (safe.split(".").pop() || "mp4").toLowerCase();
  const base = safe.replace(/\.[^/.]+$/, "");

  // ✅ keep folders tidy + unique
  const filePath = `uploads/${memberId}/${Date.now()}_${base}.${ext}`;

  // ✅ Create signed upload URL (client will PUT to signedUrl)
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(filePath);

  if (error || !data?.signedUrl) {
    return json(res, 500, {
      error: "Failed to create signed upload URL",
      details: error?.message || null,
    });
  }

  return json(res, 200, {
    bucket: BUCKET,
    path: filePath,
    signedUrl: data.signedUrl,
    contentType: contentType || "video/mp4",
  });
};
