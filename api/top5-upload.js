// api/top5-upload.js (CommonJS, Node 18+)
// ✅ Upload endpoint for Top 5 Video Generator
// ✅ Accepts multipart/form-data with a single file field named "file"
// ✅ Uploads video/audio to Supabase Storage
// ✅ Returns a public https URL for Creatomate
// ✅ Auth via Authorization Bearer OR x-nf-member-id fallback
//
// Frontend should call:
// POST /api/top5-upload
// FormData:
//   file: File
//   kind: "video" or "music"
//
// Response:
// { ok: true, url, path, bucket, fileName, contentType, size }

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Make this bucket PUBLIC in Supabase because Creatomate needs to access the file URL.
const TOP5_BUCKET =
  process.env.TOP5_BUCKET ||
  process.env.TOP5_UPLOAD_BUCKET ||
  "top5-uploads";

// -------------------- CORS --------------------
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
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-NF-Member-Id, x-nf-member-id"
  );
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// -------------------- Memberstack auth --------------------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isExpiredJwtError(err) {
  const code = err?.code;
  const msg = String(err?.message || "").toLowerCase();

  if (code === "ERR_JWT_EXPIRED") return true;
  if (msg.includes("jwtexpired") || msg.includes("jwt expired")) return true;
  if (msg.includes('"exp"') && msg.includes("failed")) return true;
  if (msg.includes("token_expired")) return true;

  return false;
}

async function getMemberId(req) {
  const token = getBearerToken(req);

  if (token) {
    if (!ms) {
      const e = new Error("MISSING_MEMBERSTACK_SECRET_KEY");
      e.code = "MISSING_MEMBERSTACK_SECRET_KEY";
      throw e;
    }

    try {
      const out = await ms.verifyToken({ token });
      const id = out?.id;

      if (!id) {
        const e = new Error("INVALID_MEMBER_TOKEN");
        e.code = "INVALID_MEMBER_TOKEN";
        throw e;
      }

      return String(id);
    } catch (err) {
      if (isExpiredJwtError(err)) {
        const e = new Error("TOKEN_EXPIRED");
        e.code = "TOKEN_EXPIRED";
        throw e;
      }

      throw err;
    }
  }

  const headerId =
    req.headers["x-nf-member-id"] ||
    req.headers["X-NF-Member-Id"] ||
    req.headers["x-nf-member-id".toLowerCase()];

  if (headerId) return String(headerId);

  const e = new Error("MISSING_AUTH");
  e.code = "MISSING_AUTH";
  throw e;
}

// -------------------- utils --------------------
function randId(len = 12) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function safeName(name) {
  const raw = String(name || "upload").trim() || "upload";
  const parts = raw.split(".");
  const ext = parts.length > 1 ? parts.pop().toLowerCase() : "";
  const base = parts.join(".") || raw;

  const cleanBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "upload";

  const cleanExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8);

  return cleanExt ? `${cleanBase}.${cleanExt}` : cleanBase;
}

function guessExt(contentType, fallbackName) {
  const n = String(fallbackName || "").toLowerCase();
  const fromName = n.match(/\.([a-z0-9]{2,8})$/)?.[1];
  if (fromName) return fromName;

  const ct = String(contentType || "").toLowerCase();

  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("quicktime")) return "mov";
  if (ct.includes("webm")) return "webm";
  if (ct.includes("x-matroska")) return "mkv";
  if (ct.includes("mpeg")) return "mp3";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("aac")) return "aac";
  if (ct.includes("ogg")) return "ogg";

  return "bin";
}

function allowedKind(kind) {
  const k = String(kind || "video").trim().toLowerCase();
  if (k === "music" || k === "audio") return "music";
  return "video";
}

function isAllowedFile(kind, contentType, filename) {
  const ct = String(contentType || "").toLowerCase();
  const name = String(filename || "").toLowerCase();

  if (kind === "music") {
    return (
      ct.startsWith("audio/") ||
      /\.(mp3|wav|m4a|aac|ogg|webm)$/i.test(name)
    );
  }

  return (
    ct.startsWith("video/") ||
    /\.(mp4|mov|avi|mkv|webm)$/i.test(name)
  );
}

// -------------------- small multipart parser --------------------
// This is intentionally simple: it supports normal browser FormData uploads.
// It parses text fields and one or more file fields, then uses the first file.
function parseMultipart(buffer, contentType) {
  const ct = String(contentType || "");
  const match = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) throw new Error("Missing multipart boundary");

  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const fields = {};
  const files = [];

  let start = buffer.indexOf(boundary);

  while (start !== -1) {
    let partStart = start + boundary.length;

    // End boundary: --boundary--
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break;

    // Skip CRLF
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (headerEnd === -1) break;

    const headerText = buffer.slice(partStart, headerEnd).toString("utf8");
    let dataStart = headerEnd + 4;

    let nextBoundary = buffer.indexOf(boundary, dataStart);
    if (nextBoundary === -1) break;

    let dataEnd = nextBoundary;
    if (buffer[dataEnd - 2] === 13 && buffer[dataEnd - 1] === 10) dataEnd -= 2;

    const data = buffer.slice(dataStart, dataEnd);

    const nameMatch = headerText.match(/name="([^"]+)"/i);
    const fileMatch = headerText.match(/filename="([^"]*)"/i);
    const typeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);

    const fieldName = nameMatch ? nameMatch[1] : "";
    const filename = fileMatch ? fileMatch[1] : "";
    const fileContentType = typeMatch ? typeMatch[1].trim() : "application/octet-stream";

    if (filename) {
      files.push({
        fieldName,
        filename,
        contentType: fileContentType,
        buffer: data,
        size: data.length,
      });
    } else if (fieldName) {
      fields[fieldName] = data.toString("utf8");
    }

    start = nextBoundary;
  }

  return { fields, files };
}

// -------------------- Supabase upload --------------------
async function uploadToSupabaseStorage({ bucket, filePath, buffer, contentType }) {
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const base = new URL(SUPABASE_URL);
  const hostname = base.hostname;

  const putPath = `/storage/v1/object/${encodeURIComponent(bucket)}/${filePath}`;

  const result = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: putPath,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": contentType || "application/octet-stream",
          "Content-Length": buffer.length,
          "x-upsert": "true",
        },
      },
      (r) => {
        let out = "";
        r.on("data", (c) => (out += c));
        r.on("end", () => resolve({ status: r.statusCode, text: out }));
      }
    );

    req.on("error", reject);
    req.write(buffer);
    req.end();
  });

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Supabase upload failed (${result.status}): ${result.text || "unknown error"}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${filePath}`;
}

// -------------------- MAIN handler --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    if (req.method !== "POST") {
      return json(res, 405, {
        ok: false,
        error: "Use POST",
      });
    }

    const member_id = await getMemberId(req);

    const contentType = req.headers["content-type"] || req.headers["Content-Type"] || "";
    if (!String(contentType).toLowerCase().includes("multipart/form-data")) {
      return json(res, 400, {
        ok: false,
        error: "Expected multipart/form-data",
      });
    }

    const raw = await readRawBody(req);
    const { fields, files } = parseMultipart(raw, contentType);

    const file = files[0];
    if (!file || !file.buffer || !file.size) {
      return json(res, 400, {
        ok: false,
        error: "Missing file",
      });
    }

    const kind = allowedKind(fields.kind || fields.type || "video");

    if (!isAllowedFile(kind, file.contentType, file.filename)) {
      return json(res, 400, {
        ok: false,
        error: kind === "music" ? "Only audio files are allowed for music." : "Only video files are allowed.",
      });
    }

    // Keep this conservative for Vercel/serverless.
    // Raise if your Vercel plan supports larger request bodies.
    const maxMb = Number(process.env.TOP5_UPLOAD_MAX_MB || 75);
    const maxBytes = maxMb * 1024 * 1024;

    if (file.size > maxBytes) {
      return json(res, 413, {
        ok: false,
        error: `File too large. Max is ${maxMb}MB.`,
      });
    }

    const clean = safeName(file.filename);
    const ext = guessExt(file.contentType, clean);
    const folder = kind === "music" ? "music" : "videos";
    const filePath = `top5/${member_id}/${folder}/${Date.now()}_${randId()}_${clean.includes(".") ? clean : `${clean}.${ext}`}`;

    const url = await uploadToSupabaseStorage({
      bucket: TOP5_BUCKET,
      filePath,
      buffer: file.buffer,
      contentType: file.contentType,
    });

    return json(res, 200, {
      ok: true,
      url,
      path: filePath,
      bucket: TOP5_BUCKET,
      fileName: file.filename,
      contentType: file.contentType,
      size: file.size,
      kind,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = err?.code;

    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) {
      return json(res, 401, {
        ok: false,
        error: "TOKEN_EXPIRED",
        message: "Session expired. Refresh and try again.",
      });
    }

    if (code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) {
      return json(res, 401, {
        ok: false,
        error: "MISSING_AUTH",
      });
    }

    if (code === "INVALID_MEMBER_TOKEN" || msg.includes("INVALID_MEMBER")) {
      return json(res, 401, {
        ok: false,
        error: "INVALID_MEMBER_TOKEN",
      });
    }

    if (code === "MISSING_MEMBERSTACK_SECRET_KEY") {
      return json(res, 500, {
        ok: false,
        error: "MISSING_MEMBERSTACK_SECRET_KEY",
      });
    }

    console.error("[top5-upload] SERVER_ERROR", err);

    return json(res, 500, {
      ok: false,
      error: "SERVER_ERROR",
      message: msg,
    });
  }
};
