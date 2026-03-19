// api/tools-resize-video.js
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

const RATIO_MAP = {
  "9:16": [9, 16],
  "16:9": [16, 9],
  "1:1": [1, 1],
  "4:5": [4, 5],
  "4:3": [4, 3],
  "21:9": [21, 9],
};

const RESOLUTION_MAP = {
  2160: "4K",
  1080: "1080p",
  720: "720p",
  480: "480p",
  360: "360p",
};

const FIT_TYPES = new Set(["fill", "contain", "cover"]);

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

async function getVideoInfo(inputPath) {
  const { stdout } = await runCommand(ffprobePath, [
    "-v", "error",
    "-print_format", "json",
    "-show_streams",
    "-show_format",
    inputPath
  ]);

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Could not parse ffprobe output");
  }

  const videoStream = (parsed.streams || []).find((s) => s.codec_type === "video");
  if (!videoStream) {
    throw new Error("No video stream found");
  }

  const width = Number(videoStream.width || 0);
  const height = Number(videoStream.height || 0);
  const duration = Number(parsed.format?.duration || videoStream.duration || 0);

  if (!width || !height) {
    throw new Error("Could not determine source video dimensions");
  }

  return {
    width,
    height,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
}

function getTargetDimensions(ratio, resolutionHeight) {
  const pair = RATIO_MAP[ratio];
  if (!pair) {
    throw new Error("Unsupported ratio");
  }

  const [rw, rh] = pair;
  const outH = Number(resolutionHeight);

  if (!Number.isFinite(outH) || outH <= 0) {
    throw new Error("Invalid resolution");
  }

  const outW = Math.round((outH * rw) / rh);

  return { width: outW, height: outH };
}

function getResizeFilter({ fitType, targetWidth, targetHeight }) {
  if (!FIT_TYPES.has(fitType)) {
    throw new Error("Unsupported fit type");
  }

  if (fitType === "fill") {
    return `scale=${targetWidth}:${targetHeight},setsar=1`;
  }

  if (fitType === "contain") {
    return [
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease`,
      `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "setsar=1"
    ].join(",");
  }

  // cover
  return [
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`,
    `crop=${targetWidth}:${targetHeight}`,
    "setsar=1"
  ].join(",");
}

function ratioToLabel(width, height) {
  function gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b) {
      const t = b;
      b = a % b;
      a = t;
    }
    return a || 1;
  }

  const d = gcd(width, height);
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

async function resizeVideo({
  inputPath,
  outputPath,
  fitType,
  targetWidth,
  targetHeight,
}) {
  const vf = getResizeFilter({
    fitType,
    targetWidth,
    targetHeight,
  });

  await runCommand(ffmpegPath, [
    "-y",
    "-i", inputPath,
    "-vf", vf,
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
    ratio,
    resolution,
    fitType,
    originalFileName,
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

  if (!RATIO_MAP[ratio]) {
    return json(res, 400, {
      ok: false,
      error: "Invalid ratio",
      allowed: Object.keys(RATIO_MAP)
    });
  }

  const resNum = Number(resolution);
  if (!RESOLUTION_MAP[resNum]) {
    return json(res, 400, {
      ok: false,
      error: "Invalid resolution",
      allowed: Object.keys(RESOLUTION_MAP)
    });
  }

  if (!FIT_TYPES.has(fitType)) {
    return json(res, 400, {
      ok: false,
      error: "Invalid fitType",
      allowed: Array.from(FIT_TYPES)
    });
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

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "nf-resize-"));
  const inputFile = path.join(tempDir, `input.${ext}`);
  const outputFile = path.join(tempDir, "resized.mp4");

  try {
    const signedInput = await supabaseAdmin.storage
      .from(inputBucket)
      .createSignedUrl(inputPath, 60 * 20);

    if (signedInput.error || !signedInput.data?.signedUrl) {
      throw new Error(signedInput.error?.message || "Failed to create signed input URL");
    }

    await downloadToFile(signedInput.data.signedUrl, inputFile);

    const sourceInfo = await getVideoInfo(inputFile);
    const target = getTargetDimensions(ratio, resNum);

    await resizeVideo({
      inputPath: inputFile,
      outputPath: outputFile,
      fitType,
      targetWidth: target.width,
      targetHeight: target.height,
    });

    const outputPath = `tools/resize/${memberId}/${jobId}/resized.mp4`;
    const outputBuffer = await fsp.readFile(outputFile);

    const uploadRes = await supabaseAdmin.storage
      .from(outputBucket)
      .upload(outputPath, outputBuffer, {
        contentType: "video/mp4",
        upsert: true
      });

    if (uploadRes.error) {
      throw new Error(uploadRes.error.message || "Failed to upload resized video");
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
      fileName: `${baseName}_resized.mp4`,
      downloadUrl: signedOutput.data.signedUrl,
      originalWidth: sourceInfo.width,
      originalHeight: sourceInfo.height,
      originalRatio: ratioToLabel(sourceInfo.width, sourceInfo.height),
      originalDuration: sourceInfo.duration,
      outputWidth: target.width,
      outputHeight: target.height,
      outputRatio: ratio,
      resolutionLabel: RESOLUTION_MAP[resNum],
      fitType,
    });
  } catch (err) {
    console.error("tools-resize-video error:", err);
    return json(res, 500, {
      ok: false,
      error: err.message || "Failed to resize video"
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
