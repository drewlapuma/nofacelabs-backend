// api/user-video-caption.js (CommonJS, Node 18+)
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

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const body = await readJson(req);
  if (!body) return json(res, 400, { error: "Missing body" });
  if (body === "__INVALID__") return json(res, 400, { error: "Invalid JSON" });

  const {
    path,
    width,
    height,
    captionStyle,
    captionSettings
  } = body;

  if (!path || !width || !height) {
    return json(res, 400, { error: "path, width, height are required" });
  }
  if (!captionStyle) {
    return json(res, 400, { error: "captionStyle is required" });
  }

  // ✅ Server env vars
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const BUCKET =
    process.env.SUPABASE_UPLOAD_BUCKET ||
    process.env.USER_VIDEOS_BUCKET ||
    "user-uploads";

  // You'll already have these for Creatomate in your other code:
  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }
  if (!CREATOMATE_API_KEY) {
    return json(res, 500, { error: "Missing CREATOMATE_API_KEY" });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ✅ Build a public (or signed) URL to the uploaded video for Creatomate
  // Option A (works if your bucket is public): getPublicUrl
  // Option B (works if private): createSignedUrl
  let videoUrl = null;

  // Try public first:
  const pub = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  if (pub?.data?.publicUrl) {
    videoUrl = pub.data.publicUrl;
  }

  // If bucket is private, fall back to signed:
  if (!videoUrl) {
    const { data: signed, error: signErr } = await supabaseAdmin
      .storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60); // 1 hour

    if (signErr || !signed?.signedUrl) {
      return json(res, 500, { error: "Failed to create signed video URL", details: signErr?.message });
    }
    videoUrl = signed.signedUrl;
  }

  // TODO: Start your Creatomate render here (same way you do for AI videos),
  // using videoUrl + captionStyle + captionSettings.
  //
  // For now, respond so you can confirm the endpoint works end-to-end:
  return json(res, 200, {
    ok: true,
    received: { path, width, height, captionStyle },
    videoUrl,
    captionSettings: captionSettings || {},
    // You will return: { renderId: "..." } once you wire Creatomate render.
  });
};
