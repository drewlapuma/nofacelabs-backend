// api/tools-generate-video.js
// CommonJS, Node 18+

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  getVideoCredits,
  deductCredits,
  addCredits
} = require("./_lib/credits");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPPORTED_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"]);
const SUPPORTED_RESOLUTIONS = new Set(["480p", "720p", "1080p"]);
const SUPPORTED_DURATIONS = new Set([
  "4", "5", "6", "7", "8", "9", "10", "11", "12"
]);

const SUPPORTED_MODELS = {
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

function normalizeOptionalImageUrl(input) {
  const v = String(input || "").trim();
  return /^https?:\/\//i.test(v) ? v : "";
}

function mapOpenAISize(aspectRatio, resolution) {
  const use1080 = resolution === "1080p";

  if (aspectRatio === "9:16") {
    return use1080 ? "1080x1920" : "720x1280";
  }

  if (aspectRatio === "1:1") {
    return use1080 ? "1080x1080" : "720x720";
  }

  return use1080 ? "1920x1080" : "1280x720";
}

function normalizeVeoConfig({ aspectRatio, resolution, durationSeconds }) {
  let ratio = String(aspectRatio || "16:9");
  let res = String(resolution || "720p");
  let dur = String(durationSeconds || "8");

  if (!["16:9", "9:16"].includes(ratio)) ratio = "16:9";
  if (!["720p", "1080p"].includes(res)) res = "720p";
  if (!["4", "6", "8"].includes(dur)) dur = "8";

  return {
    aspectRatio: ratio,
    resolution: res,
    durationSeconds: dur,
  };
}

function normalizeSoraConfig({ aspectRatio, resolution, durationSeconds }) {
  let ratio = String(aspectRatio || "16:9");
  let res = String(resolution || "720p");
  let dur = String(durationSeconds || "8");

  if (!["16:9", "9:16"].includes(ratio)) ratio = "16:9";
  if (!["720p", "1080p"].includes(res)) res = "720p";

  if (!["4", "8", "12"].includes(dur)) {
    const durNum = Number(dur);
    if (durNum <= 4) dur = "4";
    else if (durNum <= 8) dur = "8";
    else dur = "12";
  }

  return {
    aspectRatio: ratio,
    resolution: res,
    durationSeconds: dur,
  };
}

function normalizeXaiConfig({ aspectRatio, resolution, durationSeconds }) {
  let ratio = String(aspectRatio || "16:9");
  let res = String(resolution || "720p");
  let dur = String(durationSeconds || "6");

  if (!["16:9", "9:16"].includes(ratio)) ratio = "16:9";
  if (!["480p", "720p"].includes(res)) res = "720p";
  if (!["6", "10"].includes(dur)) dur = "6";

  return {
    aspectRatio: ratio,
    resolution: res,
    durationSeconds: dur,
  };
}

async function tryOpenAISoraCreate({ apiKey, payload }) {
  const res = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);

  return { res, data };
}

async function createOpenAISoraJob({
  apiKey,
  modelId,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
  imageUrl,
}) {
  const normalized = normalizeSoraConfig({
    aspectRatio,
    resolution,
    durationSeconds: String(durationSeconds),
  });

  const size = mapOpenAISize(normalized.aspectRatio, normalized.resolution);

  const payload = {
    model: modelId,
    prompt,
    size,
    seconds: String(normalized.durationSeconds),
  };

  if (imageUrl) {
    payload.input_reference = {
      image_url: imageUrl,
    };
  }

  const res = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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
      aspectRatio: normalized.aspectRatio,
      resolution: normalized.resolution,
      durationSeconds: String(normalized.durationSeconds),
      size,
      usedImageUrl: !!imageUrl,
    },
  };
}

    lastError =
      data?.error?.message ||
      data?.message ||
      `OpenAI video create failed: HTTP ${res.status}`;
  }

  throw new Error(lastError || "OpenAI video create failed");
}

async function createGoogleVeoJob({
  apiKey,
  modelId,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
  imageUrl,
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

  const effectivePrompt = imageUrl
    ? `${prompt}\n\nUse the provided starting scene image as the visual anchor for this animation. Preserve subject identity, composition logic, and scene styling.`
    : prompt;

  const body = {
    instances: [{ prompt: effectivePrompt }],
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
    normalizedConfig: {
      ...normalized,
      usedImageUrl: false,
    },
  };
}

async function createXaiVideoJob({
  apiKey,
  modelId,
  prompt,
  aspectRatio,
  resolution,
  durationSeconds,
  imageUrl,
}) {
  const normalized = normalizeXaiConfig({
    aspectRatio,
    resolution,
    durationSeconds: String(durationSeconds),
  });

  const safeDuration = Number(normalized.durationSeconds);

  const effectivePrompt = imageUrl
    ? `${prompt}\n\nMatch the supplied scene image as closely as possible for subject identity and scene composition.`
    : prompt;

  const res = await fetch("https://api.x.ai/v1/videos/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      prompt: effectivePrompt,
      duration: safeDuration,
      aspect_ratio: normalized.aspectRatio,
      resolution: normalized.resolution,
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
    status: "pending",
    progress: 0,
    raw: data,
    normalizedConfig: {
      aspectRatio: normalized.aspectRatio,
      resolution: normalized.resolution,
      durationSeconds: String(normalized.durationSeconds),
      usedImageUrl: false,
    },
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  let creditsDeducted = false;
  let refundContext = null;

  try {
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
    const imageUrl = normalizeOptionalImageUrl(body.imageUrl || body.startImageUrl);

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

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, {
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const internalJobId = crypto.randomUUID();

    const creditCost = getVideoCredits({
      model,
      durationSeconds: Number(durationSeconds),
      resolution
    });

    refundContext = {
      supabaseAdmin,
      memberId,
      amount: creditCost,
      reason: "video_generation_refund",
      toolType: "video_generate",
      model,
      jobId: internalJobId,
      metadata: {
        aspectRatio,
        resolution,
        durationSeconds,
        imageUrl,
      }
    };

    await deductCredits({
      supabaseAdmin,
      memberId,
      amount: creditCost,
      reason: "video_generation",
      toolType: "video_generate",
      model,
      jobId: internalJobId,
      metadata: {
        aspectRatio,
        resolution,
        durationSeconds,
        imageUrl,
      }
    });

    creditsDeducted = true;

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
        imageUrl,
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
        imageUrl,
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
        imageUrl,
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
      creditCost,
      provider: started.provider,
      providerJobId: started.providerJobId,
      status: started.status || "queued",
      progress: Number(started.progress || 0),
      pollAfterMs: 4000,
      normalizedConfig: started.normalizedConfig,
      providerRaw: started.raw,
    });
  } catch (err) {
    if (creditsDeducted && refundContext) {
      try {
        await addCredits(refundContext);
      } catch (refundErr) {
        console.error("tools-generate-video refund error:", refundErr);
      }
    }

    console.error("tools-generate-video error:", err);

    if (err.code === "INSUFFICIENT_CREDITS") {
      return json(res, 402, {
        ok: false,
        error: "Not enough credits",
        balance: err.balance,
        required: err.required
      });
    }

    return json(res, 500, {
      ok: false,
      error: err.message || "Failed to start video generation",
    });
  }
};
