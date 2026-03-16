// api/tools-upload-url.js
// CommonJS, Node 18+
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_TOOL_TYPES = new Set([
  "trim",
  "resize",
  "compress",
  "image_generate",
  "video_generate",
  "general",
]);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
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
  return String(name || "file.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

function safeSegment(value, fallback = "unknown") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

function makeJobId() {
  return crypto.randomUUID();
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const body = await readJson(req);
  if (!body) return json(res, 400, { ok: false, error: "Missing body" });
  if (body === "__INVALID__") {
    return json(res, 400, { ok: false, error: "Invalid JSON" });
  }

  const fileName = body.fileName || body.filename || body.name;
  const fileSize = body.fileSize || body.size;
  const contentType = body.contentType || body.type || "application/octet-stream";

  let toolType = safeSegment(body.toolType || "general").toLowerCase();
  if (!ALLOWED_TOOL_TYPES.has(toolType)) {
    return json(res, 400, {
      ok: false,
      error: "Invalid toolType",
      allowed: Array.from(ALLOWED_TOOL_TYPES),
    });
  }

  const memberId = safeSegment(
    body.memberId || req.headers["x-nf-member-id"] || "anonymous"
  );

  if (!fileName || !fileSize) {
    return json(res, 400, {
      ok: false,
      error: "fileName and fileSize are required",
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const INPUT_BUCKET = process.env.SUPABASE_TOOL_INPUTS_BUCKET || "tool-inputs";
  const OUTPUT_BUCKET = process.env.SUPABASE_TOOL_OUTPUTS_BUCKET || "tool-outputs";

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
  const ext = (safe.split(".").pop() || "bin").toLowerCase();
  const jobId = makeJobId();

  // Original uploads always go into tool-inputs
  const path = `tools/${toolType}/${memberId}/${jobId}/original.${ext}`;

  const { data, error } = await supabaseAdmin.storage
    .from(INPUT_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    return json(res, 500, {
      ok: false,
      error: "Failed to create signed upload URL",
      details: error?.message || null,
    });
  }

  let signedReadUrl = null;
  try {
    const signedGet = await supabaseAdmin.storage
      .from(INPUT_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24); // 24h
    signedReadUrl = signedGet?.data?.signedUrl || null;
  } catch {
    signedReadUrl = null;
  }

  return json(res, 200, {
    ok: true,
    jobId,
    toolType,
    memberId,

    inputBucket: INPUT_BUCKET,
    outputBucket: OUTPUT_BUCKET,

    path,
    uploadUrl: data.signedUrl,

    // Temporary preview/read URL for the uploaded original file
    fileUrl: signedReadUrl,

    originalFileName: safe,
    fileSize,
    contentType,
  });
};
