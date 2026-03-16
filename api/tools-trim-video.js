// api/tools-trim-video.js
// CommonJS, Node 18+
// Uses bundled ffmpeg-static + ffprobe-static binaries for Vercel

const { createClient } = require("@supabase/supabase-js");
const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;

if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary not found");
}
if (!ffprobePath) {
  throw new Error("ffprobe-static binary not found");
}

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin || "";

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
  res.setHeader("Access-Control-Max-Age", "86400");
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

function safeSegment(value, fallback = "unknown") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 80);
}

function safeName(name, fallback = "video.mp4") {
  return String(name || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 140);
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}\n${stderr || stdout}`));
      }
    });
  });
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download input file: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fsp.writeFile(outPath, Buffer.from(arrayBuffer));
}

async function getVideoDurationSeconds(inputPath) {
  const { stdout } = await runCommand(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    inputPath
  ]);

  const n = Number(String(stdout || "").trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Could not determine video duration");
  }
  return n;
}

async function trimVideo({ inputPath, outputPath, startTime, endTime }) {
  const duration = Math.max(0.01, endTime - startTime);

  await runCommand(ffmpegPath, [
    "-y",
    "-ss", String(startTime),
    "-i", inputPath,
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ]);
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

  const {
    jobId,
    inputBucket,
    inputPath,
    outputBucket,
    startTime,
    endTime,
    originalFileName
  } = body;

  const memberId = safeSegment(
    body.memberId || req.headers["x-nf-member-id"] || "anonymous"
  );

  if (!jobId || !inputBucket || !inputPath || !outputBucket) {
    return json(res, 400, {
      ok: false,
      error: "jobId, inputBucket, inputPath, and outputBucket are required"
    });
  }

  const startNum = Number(startTime);
  const endNum = Number(endTime);

  if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) {
    return json(res, 400, {
      ok: false,
      error: "startTime and endTime must be numbers"
    });
  }

  if (startNum < 0 || endNum <= startNum) {
    return json(res, 400, { ok: false, error: "Invalid trim range" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });

  const safeOriginal = safeName(originalFileName || "video.mp4");
  const ext = (safeOriginal.split(".").pop() || "mp4").toLowerCase();
  const baseName = safeOriginal.replace(/\.[^/.]+$/, "") || "video";

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nf-trim-"));
  const inputFile = path.join(tempDir, `input.${ext}`);
  const outputFile = path.join(tempDir, "trimmed.mp4");

  try {
    const signedInput = await supabaseAdmin.storage
      .from(inputBucket)
      .createSignedUrl(inputPath, 60 * 20);

    if (signedInput.error || !signedInput.data?.signedUrl) {
      throw new Error(signedInput.error?.message || "Failed to create signed input URL");
    }

    await downloadToFile(signedInput.data.signedUrl, inputFile);

    const actualDuration = await getVideoDurationSeconds(inputFile);
    const safeStart = Math.max(0, Math.min(startNum, actualDuration - 0.05));
    const safeEnd = Math.max(safeStart + 0.05, Math.min(endNum, actualDuration));

    if (safeEnd <= safeStart) {
      throw new Error("Trim range is outside the video duration");
    }

    await trimVideo({
      inputPath: inputFile,
      outputPath: outputFile,
      startTime: safeStart,
      endTime: safeEnd
    });

    const outputPath = `tools/trim/${memberId}/${jobId}/trimmed.mp4`;
    const outputBuffer = await fsp.readFile(outputFile);

    const uploadRes = await supabaseAdmin.storage
      .from(outputBucket)
      .upload(outputPath, outputBuffer, {
        contentType: "video/mp4",
        upsert: true
      });

    if (uploadRes.error) {
      throw new Error(uploadRes.error.message || "Failed to upload trimmed video");
    }

    const signedOutput = await supabaseAdmin.storage
      .from(outputBucket)
      .createSignedUrl(outputPath, 60 * 60 * 24);

    if (signedOutput.error || !signedOutput.data?.signedUrl) {
      throw new Error(signedOutput.error?.message || "Failed to create signed output URL");
    }

    return json(res, 200, {
      ok: true,
      jobId,
      memberId,
      inputBucket,
      inputPath,
      outputBucket,
      outputPath,
      fileName: `${baseName}_trimmed.mp4`,
      downloadUrl: signedOutput.data.signedUrl,
      startTime: safeStart,
      endTime: safeEnd,
      trimmedDuration: Number((safeEnd - safeStart).toFixed(3))
    });
  } catch (err) {
    console.error("tools-trim-video error:", err);
    return json(res, 500, {
      ok: false,
      error: err.message || "Failed to trim video"
    });
  } finally {
    try {
      if (fs.existsSync(inputFile)) await fsp.unlink(inputFile);
    } catch {}
    try {
      if (fs.existsSync(outputFile)) await fsp.unlink(outputFile);
    } catch {}
    try {
      if (fs.existsSync(tempDir)) {
        await fsp.rm(tempDir, { recursive: true, force: true });
      }
    } catch {}
  }
};
