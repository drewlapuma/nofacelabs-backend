// api/tools-generate-video.js
// CommonJS, Node 18+

const crypto = require("crypto");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPPORTED_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const SUPPORTED_RESOLUTIONS = new Set(["720p", "1080p", "4k"]);
const SUPPORTED_DURATIONS = new Set(["4", "5", "6", "8", "10"]);

const SUPPORTED_MODELS = {
  // Google Veo
  "veo-3.1": {
    provider: "google-veo",
    label: "Veo 3.1",
    modelIdEnv: "VEO_31_MODEL_ID",
    defaultModelId: "veo-3.1-generate-preview",
  },
  "veo-3.1-fast": {
    provider: "google-veo",
    label: "Veo 3.1 Fast",
    modelIdEnv: "VEO_31_FAST_MODEL_ID",
    defaultModelId: "veo-3.1-fast-generate-preview",
  },
  "veo-3": {
    provider: "google-veo",
    label: "Veo 3",
    modelIdEnv: "VEO_3_MODEL_ID",
    defaultModelId: "veo-3.0-generate-001",
  },
  "veo-3-fast": {
    provider: "google-veo",
    label: "Veo 3 Fast",
    modelIdEnv: "VEO_3_FAST_MODEL_ID",
    defaultModelId: "veo-3.0-fast-generate-001",
  },

  // OpenAI Sora
  "sora-2": {
    provider: "openai-sora",
    label: "Sora 2",
    modelId: "sora-2",
  },
  "sora-2-pro": {
    provider: "openai-sora",
    label: "Sora 2 Pro",
    modelId: "sora-2-pro",
  },

  // xAI
  "grok-imagine-video": {
    provider: "xai-video",
    label: "Grok Imagine Video",
    modelId: "grok-imagine-video",
  },
};

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

function resolveModelId(modelKey) {
  const meta = SUPPORTED_MODELS[modelKey];
  if (!meta) return null;
  if (meta.modelId) return meta.modelId;
  if (meta.modelIdEnv && process.env[meta.modelIdEnv]) return process.env[meta.modelIdEnv];
  return meta.defaultModelId || null;
}

function normalizeAspectRatio(input) {
  const v = String(input || "16:9").trim();
  if (!SUPPORTED_ASPECT_RATIOS.has(v)) return "16:9";
  return v;
}

function normalizeResolution(input) {
  const v = String(input || "720p").toLowerCase().trim();
  if (!SUPPORTED_RESOLUTIONS.has(v)) return "720p";
  return v;
}

function normalizeDuration(input) {
  const v = String(input || "8").trim();
  if (!SUPPORTED_DURATIONS.has(v)) return "8";
  return v;
}

function mapOpenAISize(aspectRatio, resolution, model) {
  const is1080Allowed = model === "sora-2-pro";
  const is4kRequested = resolution === "4k";
  const use1080 = resolution === "1080p" || is4kRequested;

  if (aspectRatio === "9:16") {
    if (use1080 && is1080Allowed) return "1080x1920";
    return "720x1280";
  }

  if (aspectRatio === "1:1") {
    if (use1080 && is1080Allowed) return "1080x1080";
    return "720x720";
  }

  if (use1080 && is1080Allowed) return "1920x1080";
  return "1280x720";
}

function normalizeVeoConfig({ aspectRatio, resolution, durationSeconds }) {
  let ratio = aspectRatio;
  let res = resolution;
  let dur = durationSeconds;

  if (ratio === "1:1") ratio = "16:9";
  if (!["16:9", "9:16"].includes(ratio)) ratio = "16:9";

  if (!["4", "6", "8"].includes(dur)) dur = "8";

  if ((res === "1080p" || res === "4k") && dur !== "8") {
    dur = "8";
  }

  return {
    aspectRatio: ratio,
    resolution: res,
    durationSeconds: dur,
  };
}

function normalizeXaiConfig({ aspectRatio, resolution, durationSeconds }) {
  return {
    aspectRatio,
    resolution,
    durationSeconds,
  };
}

async function createOpenAISoraJob({
  apiKey,
  modelId,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
}) {
  const size = mapOpenAISize(aspectRatio, resolution, modelId);

  const res = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      prompt,
      size,
      seconds: String(durationSeconds),
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      `OpenAI video create failed: HTTP ${res.status}`
    );
  }

  return {
    provider: "openai-sora",
    providerJobId: data?.id || null,
    status: data?.status || "queued",
    progress: Number(data?.progress || 0),
    raw: data,
    normalizedConfig: {
      aspectRatio,
      resolution,
      durationSeconds: String(durationSeconds),
      size,
    },
  };
}

async function createGoogleVeoJob({
  apiKey,
  modelId,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
}) {
  const normalized = normalizeVeoConfig({
    aspectRatio,
    resolution,
    durationSeconds: String(durationSeconds),
  });

  const apiVersion = process.env.GOOGLE_GENAI_API_VERSION || "v1beta";
  const endpoint =
    `https://generativelanguage.googleapis.com/${apiVersion}/models/` +
    `${encodeURIComponent(modelId)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;

  const body = {
    instances: [{ prompt }],
    parameters: {
      aspectRatio: normalized.aspectRatio,
      resolution: normalized.resolution,
      durationSeconds: Number(normalized.durationSeconds),
      sampleCount: 1,
    },
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      JSON.stringify(data) ||
      `Google Veo create failed: HTTP ${res.status}`
    );
  }

  return {
    provider: "google-veo",
    providerJobId: data?.name || null,
    status: data?.done ? "completed" : "queued",
    progress: 0,
    raw: data,
    normalizedConfig: normalized,
  };
}

async function createXaiVideoJob({
  apiKey,
  modelId,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
}) {
  const normalized = normalizeXaiConfig({
    aspectRatio,
    resolution,
    durationSeconds: String(durationSeconds),
  });

  const res = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      prompt,
      aspect_ratio: normalized.aspectRatio,
      resolution: normalized.resolution,
      duration_seconds: Number(normalized.durationSeconds),
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      JSON.stringify(data) ||
      `xAI video create failed: HTTP ${res.status}`
    );
  }

  return {
    provider: "xai-video",
    providerJobId: data?.request_id || data?.id || null,
    status: data?.status || "queued",
    progress: Number(data?.progress || 0),
    raw: data,
    normalizedConfig: normalized,
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

  const memberId = safeSegment(
    body.memberId || req.headers["x-nf-member-id"] || "anonymous"
  );

  const prompt = String(body.prompt || "").trim();
  const model = String(body.model || "").trim();
  const aspectRatio = normalizeAspectRatio(body.aspectRatio);
  const resolution = normalizeResolution(body.resolution);
  const durationSeconds = normalizeDuration(body.durationSeconds);

  if (!prompt) {
    return json(res, 400, { ok: false, error: "prompt is required" });
  }

  if (prompt.length > 1600) {
    return json(res, 400, { ok: false, error: "prompt is too long" });
  }

  if (!SUPPORTED_MODELS[model]) {
    return json(res, 400, {
      ok: false,
      error: "Invalid model",
      allowed: Object.keys(SUPPORTED_MODELS),
    });
  }

  const modelMeta = SUPPORTED_MODELS[model];
  const resolvedModelId = resolveModelId(model);

  if (!resolvedModelId) {
    return json(res, 500, {
      ok: false,
      error: `Could not resolve provider model id for ${model}`,
    });
  }

  const internalJobId = crypto.randomUUID();

  try {
    let started;

    if (modelMeta.provider === "openai-sora") {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("Missing OPENAI_API_KEY");
      }

      started = await createOpenAISoraJob({
        apiKey: process.env.OPENAI_API_KEY,
        modelId: resolvedModelId,
        prompt,
        aspectRatio,
        resolution,
        durationSeconds,
      });
    } else if (modelMeta.provider === "google-veo") {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY");
      }

      started = await createGoogleVeoJob({
        apiKey: process.env.GEMINI_API_KEY,
        modelId: resolvedModelId,
        prompt,
        aspectRatio,
        resolution,
        durationSeconds,
      });
    } else if (modelMeta.provider === "xai-video") {
      if (!process.env.XAI_API_KEY) {
        throw new Error("Missing XAI_API_KEY");
      }

      started = await createXaiVideoJob({
        apiKey: process.env.XAI_API_KEY,
        modelId: resolvedModelId,
        prompt,
        aspectRatio,
        resolution,
        durationSeconds,
      });
    } else {
      throw new Error("Unsupported provider");
    }

    return json(res, 200, {
      ok: true,
      jobId: internalJobId,
      memberId,
      model,
      modelLabel: modelMeta.label,
      provider: started.provider,
      providerJobId: started.providerJobId,
      status: started.status || "queued",
      progress: Number(started.progress || 0),
      pollAfterMs: 4000,
      normalizedConfig: started.normalizedConfig,
      providerRaw: started.raw,
    });
  } catch (err) {
    console.error("tools-generate-video error:", err);
    return json(res, 500, {
      ok: false,
      error: err.message || "Failed to start video generation",
    });
  }
};
