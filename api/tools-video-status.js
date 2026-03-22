// api/tools-video-status.js
// CommonJS, Node 18+
//
// Polls a previously-started video generation job and returns a normalized status.
// If complete, uploads the final mp4 to Supabase and returns a signed URL.
//
// Providers:
// - OpenAI Sora -> GET /v1/videos/{id} and /content
// - Google Veo -> REST long-running operation polling
// - BytePlus Seedance -> env-configurable retrieve endpoint

const { createClient } = require("@supabase/supabase-js");

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

function safeFileName(name, fallback = "video.mp4") {
  return String(name || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 160);
}

function extFromContentType(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("quicktime")) return "mov";
  if (ct.includes("webm")) return "webm";
  return "mp4";
}

async function downloadToBuffer(url, headers = {}) {
  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`Failed to download provider video: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || "video/mp4",
  };
}

async function uploadFinalVideoToSupabase({
  supabaseAdmin,
  outputBucket,
  memberId,
  model,
  jobId,
  buffer,
  contentType,
}) {
  const ext = extFromContentType(contentType);
  const fileName = safeFileName(`${model}_${jobId}.${ext}`);
  const outputPath = `tools/video-generate/${memberId}/${fileName}`;

  const uploadRes = await supabaseAdmin.storage
    .from(outputBucket)
    .upload(outputPath, buffer, {
      contentType,
      upsert: true,
    });

  if (uploadRes.error) {
    throw new Error(uploadRes.error.message || "Failed to upload final video");
  }

  const signedOutput = await supabaseAdmin.storage
    .from(outputBucket)
    .createSignedUrl(outputPath, 60 * 60 * 24);

  if (signedOutput.error || !signedOutput.data?.signedUrl) {
    throw new Error(
      signedOutput.error?.message || "Failed to create signed video URL"
    );
  }

  return {
    outputPath,
    fileName,
    downloadUrl: signedOutput.data.signedUrl,
  };
}

async function pollOpenAISora({
  apiKey,
  providerJobId,
}) {
  const metaRes = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(providerJobId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  });

  const meta = await metaRes.json().catch(() => null);

  if (!metaRes.ok) {
    throw new Error(
      meta?.error?.message ||
      meta?.message ||
      `OpenAI video status failed: HTTP ${metaRes.status}`
    );
  }

  const status = String(meta?.status || "").toLowerCase();
  const progress = Number(meta?.progress || 0);

  if (status !== "completed") {
    return {
      status: status || "queued",
      progress,
      isComplete: false,
      raw: meta,
    };
  }

  const contentRes = await fetch(
    `https://api.openai.com/v1/videos/${encodeURIComponent(providerJobId)}/content`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
    }
  );

  if (!contentRes.ok) {
    const contentErr = await contentRes.text().catch(() => "");
    throw new Error(
      contentErr || `OpenAI video content download failed: HTTP ${contentRes.status}`
    );
  }

  const arrayBuffer = await contentRes.arrayBuffer();

  return {
    status: "completed",
    progress: 100,
    isComplete: true,
    raw: meta,
    finalVideo: {
      buffer: Buffer.from(arrayBuffer),
      contentType: contentRes.headers.get("content-type") || "video/mp4",
    },
  };
}

async function pollGoogleVeo({
  apiKey,
  providerJobId,
}) {
  const apiVersion = process.env.GOOGLE_GENAI_API_VERSION || "v1beta";
  const endpoint =
    `https://generativelanguage.googleapis.com/${apiVersion}/` +
    `${providerJobId}?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  const operation = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      operation?.error?.message ||
      operation?.message ||
      JSON.stringify(operation) ||
      `Google Veo status failed: HTTP ${res.status}`
    );
  }

  const done = Boolean(operation?.done);

  if (!done) {
    return {
      status: "queued",
      progress: 0,
      isComplete: false,
      raw: operation,
    };
  }

  const generatedVideo =
    operation?.response?.generatedVideos?.[0] ||
    operation?.response?.videos?.[0] ||
    operation?.generatedVideos?.[0] ||
    operation?.videos?.[0] ||
    null;

  const fileUri =
    generatedVideo?.video?.uri ||
    generatedVideo?.video?.fileUri ||
    generatedVideo?.uri ||
    operation?.response?.generatedVideos?.[0]?.video?.uri ||
    operation?.response?.generatedVideos?.[0]?.video?.fileUri ||
    null;

  if (!fileUri) {
    throw new Error(
      "Google Veo operation completed but no video file URI was returned: " +
      JSON.stringify(operation)
    );
  }

  const finalVideo = await downloadToBuffer(fileUri);

  return {
    status: "completed",
    progress: 100,
    isComplete: true,
    raw: operation,
    finalVideo,
  };
}
async function pollSeedance({
  apiKey,
  providerJobId,
}) {
  const retrieveUrlBase = process.env.BYTEPLUS_VIDEO_RETRIEVE_URL;

  if (!retrieveUrlBase) {
    throw new Error(
      "Missing BYTEPLUS_VIDEO_RETRIEVE_URL. Set the exact BytePlus retrieve-task endpoint."
    );
  }

  const retrieveUrl = retrieveUrlBase.includes("{task_id}")
    ? retrieveUrlBase.replace("{task_id}", encodeURIComponent(providerJobId))
    : `${retrieveUrlBase.replace(/\/$/, "")}/${encodeURIComponent(providerJobId)}`;

  const res = await fetch(retrieveUrl, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `BytePlus video status failed: HTTP ${res.status}`
    );
  }

  const status = String(
    data?.status ||
    data?.task_status ||
    data?.data?.status ||
    data?.data?.task_status ||
    ""
  ).toLowerCase();

  if (status !== "completed" && status !== "succeeded" && status !== "success") {
    return {
      status: status || "queued",
      progress: Number(data?.progress || data?.data?.progress || 0),
      isComplete: false,
      raw: data,
    };
  }

  const videoUrl =
    data?.video_url ||
    data?.output_url ||
    data?.result?.url ||
    data?.result?.video_url ||
    data?.data?.video_url ||
    data?.data?.output_url ||
    data?.data?.result?.url ||
    null;

  if (!videoUrl) {
    throw new Error("BytePlus task completed but no video URL was returned");
  }

  const finalVideo = await downloadToBuffer(videoUrl, {
    "Authorization": `Bearer ${apiKey}`,
  });

  return {
    status: "completed",
    progress: 100,
    isComplete: true,
    raw: data,
    finalVideo,
  };
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

  const jobId = String(body.jobId || "").trim();
  const provider = String(body.provider || "").trim();
  const providerJobId = String(body.providerJobId || "").trim();
  const model = String(body.model || "video").trim();
  const memberId = safeSegment(
    body.memberId || req.headers["x-nf-member-id"] || "anonymous"
  );
  const outputBucket =
    body.outputBucket ||
    process.env.SUPABASE_TOOL_OUTPUTS_BUCKET ||
    "tool-outputs";

  if (!jobId || !provider || !providerJobId) {
    return json(res, 400, {
      ok: false,
      error: "jobId, provider, and providerJobId are required",
    });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, {
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    let polled;

    if (provider === "openai-sora") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("Missing OPENAI_API_KEY");
      }

      polled = await pollOpenAISora({
        apiKey: process.env.OPENAI_API_KEY,
        providerJobId,
      });
    } else if (provider === "google-veo") {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY");
      }

      polled = await pollGoogleVeo({
        apiKey: process.env.GEMINI_API_KEY,
        providerJobId,
      });
    } else if (provider === "byteplus-seedance") {
      if (!process.env.BYTEPLUS_API_KEY) {
        throw new Error("Missing BYTEPLUS_API_KEY");
      }

      polled = await pollSeedance({
        apiKey: process.env.BYTEPLUS_API_KEY,
        providerJobId,
      });
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    if (!polled.isComplete) {
      return json(res, 200, {
        ok: true,
        jobId,
        memberId,
        provider,
        providerJobId,
        model,
        status: polled.status || "queued",
        progress: Number(polled.progress || 0),
        isComplete: false,
        pollAfterMs: 4000,
      });
    }

    const uploaded = await uploadFinalVideoToSupabase({
      supabaseAdmin,
      outputBucket,
      memberId,
      model,
      jobId,
      buffer: polled.finalVideo.buffer,
      contentType: polled.finalVideo.contentType,
    });

    return json(res, 200, {
      ok: true,
      jobId,
      memberId,
      provider,
      providerJobId,
      model,
      status: "completed",
      progress: 100,
      isComplete: true,
      outputBucket,
      outputPath: uploaded.outputPath,
      fileName: uploaded.fileName,
      downloadUrl: uploaded.downloadUrl,
    });
  } catch (err) {
    console.error("tools-video-status error:", err);
    return json(res, 500, {
      ok: false,
      error: err.message || "Failed to fetch video job status",
    });
  }
};
