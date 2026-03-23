// api/tools-generate-image.js
// CommonJS, Node 18+
// No SDK dependency required for Google image generation.
// - Nano Banana -> Google REST generateContent
// - Imagen 4 -> Google REST predict
// - FLUX.2 -> Black Forest Labs async API

const { createClient } = require("@supabase/supabase-js");
const {
  getImageCredits,
  deductCredits,
  addCredits
} = require("../lib/credits");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPPORTED_MODELS = {
  // ===== NANO BANANA =====
  "nano-banana": {
    provider: "google-gemini",
    label: "Nano Banana",
    model: "gemini-2.5-flash-image",
  },
  "nano-banana-pro": {
    provider: "google-gemini",
    label: "Nano Banana Pro",
    model: "gemini-3-pro-image-preview",
  },

  // ===== IMAGEN =====
  "imagen-4": {
    provider: "google-imagen",
    label: "Imagen 4",
    model: "imagen-4.0-generate-001",
  },
  "imagen-4-fast": {
    provider: "google-imagen",
    label: "Imagen 4 Fast",
    model: "imagen-4.0-fast-generate-001",
  },
  "imagen-4-ultra": {
    provider: "google-imagen",
    label: "Imagen 4 Ultra",
    model: "imagen-4.0-ultra-generate-001",
  },

  // ===== FLUX =====
  "flux-2": {
    provider: "bfl",
    label: "FLUX.2",
    endpoint: "https://api.bfl.ai/v1/flux-2-pro",
  },
  "flux-2-pro": {
    provider: "bfl",
    label: "FLUX.2 Pro",
    endpoint: "https://api.bfl.ai/v1/flux-2-pro",
  },
  "flux-2-max": {
    provider: "bfl",
    label: "FLUX.2 Max",
    endpoint: "https://api.bfl.ai/v1/flux-2-max",
  },
  "flux-2-flex": {
    provider: "bfl",
    label: "FLUX.2 Flex",
    endpoint: "https://api.bfl.ai/v1/flux-2-flex",
  }
};

const SUPPORTED_ASPECT_RATIOS = new Set(["1:1", "9:16", "16:9", "4:3", "3:4"]);

function setCors(req, res) {
  const origin = req.headers.origin || "";

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS,GET");
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

function safeName(name, fallback = "image.png") {
  return String(name || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 140);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadToBuffer(url, extraHeaders = {}) {
  const res = await fetch(url, { headers: extraHeaders });
  if (!res.ok) {
    throw new Error(`Failed to download generated file: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || "image/png",
  };
}

function fileExtFromContentType(contentType) {
  if (!contentType) return "png";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

async function generateWithNanoBanana({ apiKey, prompt, aspectRatio, modelName }) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        imageConfig: {
          aspectRatio,
        },
      },
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      `Nano Banana request failed: HTTP ${res.status}`
    );
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    const inlineData = part.inlineData || part.inline_data;
    if (inlineData?.data) {
      return {
        buffer: Buffer.from(inlineData.data, "base64"),
        contentType: inlineData.mimeType || inlineData.mime_type || "image/png",
      };
    }
  }

  throw new Error("Nano Banana did not return an image");
}

async function generateWithImagen({ apiKey, prompt, aspectRatio, modelName }) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:predict`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [
        {
          prompt,
        },
      ],
      parameters: {
        sampleCount: 1,
        aspectRatio,
      },
    }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      `Imagen 4 request failed: HTTP ${res.status}`
    );
  }

  const imageBytes =
    data?.predictions?.[0]?.bytesBase64Encoded ||
    data?.predictions?.[0]?.image?.imageBytes ||
    data?.generatedImages?.[0]?.image?.imageBytes;

  if (!imageBytes) {
    throw new Error("Imagen 4 did not return an image");
  }

  return {
    buffer: Buffer.from(imageBytes, "base64"),
    contentType: "image/png",
  };
}

async function generateWithFlux2({ apiKey, prompt, aspectRatio, endpoint }) {
  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      "x-key": apiKey,
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspectRatio,
      output_format: "png",
      safety_tolerance: 2,
    }),
  });

  const createData = await createRes.json().catch(() => null);

  if (!createRes.ok || !createData?.polling_url) {
    if (createRes.status === 402) {
      throw new Error("FLUX.2 is unavailable because the BFL account needs active billing or more credits.");
    }

    throw new Error(
      createData?.error ||
      createData?.message ||
      `FLUX.2 request failed: HTTP ${createRes.status}`
    );
  }

  const pollingUrl = createData.polling_url;
  const startedAt = Date.now();
  const timeoutMs = 1000 * 60 * 2;

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(1500);

    const pollRes = await fetch(pollingUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-key": apiKey,
      },
    });

    const pollData = await pollRes.json().catch(() => null);

    if (!pollRes.ok) {
      throw new Error(
        pollData?.error ||
        pollData?.message ||
        `FLUX.2 polling failed: HTTP ${pollRes.status}`
      );
    }

    const status = String(pollData?.status || "").toLowerCase();

    if (status === "ready") {
      const sampleUrl = pollData?.result?.sample;
      if (!sampleUrl) {
        throw new Error("FLUX.2 finished but did not provide an image URL");
      }
      return downloadToBuffer(sampleUrl, { "x-key": apiKey });
    }

    if (status === "error" || status === "failed") {
      throw new Error(
        pollData?.error ||
        pollData?.message ||
        "FLUX.2 generation failed"
      );
    }
  }

  throw new Error("FLUX.2 generation timed out");
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      route: "tools-generate-image",
      status: "ready",
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  let creditsDeducted = false;
  let creditCost = 0;
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
    const aspectRatio = String(body.aspectRatio || "1:1").trim();

    if (!prompt) {
      return json(res, 400, { ok: false, error: "prompt is required" });
    }

    if (prompt.length > 1200) {
      return json(res, 400, { ok: false, error: "prompt is too long" });
    }

    if (!SUPPORTED_MODELS[model]) {
      return json(res, 400, {
        ok: false,
        error: "Invalid model",
        allowed: Object.keys(SUPPORTED_MODELS),
      });
    }

    if (!SUPPORTED_ASPECT_RATIOS.has(aspectRatio)) {
      return json(res, 400, {
        ok: false,
        error: "Invalid aspectRatio",
        allowed: Array.from(SUPPORTED_ASPECT_RATIOS),
      });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

    const provider = SUPPORTED_MODELS[model];
    creditCost = getImageCredits(model);

    refundContext = {
      supabaseAdmin,
      memberId,
      amount: creditCost,
      reason: "image_generation_refund",
      toolType: "image_generate",
      model,
      metadata: {
        aspectRatio
      }
    };

    await deductCredits({
      supabaseAdmin,
      memberId,
      amount: creditCost,
      reason: "image_generation",
      toolType: "image_generate",
      model,
      metadata: {
        aspectRatio
      }
    });

    creditsDeducted = true;

    let generated;

    if (provider.provider === "google-gemini") {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY");
      }

      generated = await generateWithNanoBanana({
        apiKey: process.env.GEMINI_API_KEY,
        prompt,
        aspectRatio,
        modelName: provider.model,
      });
    } else if (provider.provider === "google-imagen") {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY");
      }

      generated = await generateWithImagen({
        apiKey: process.env.GEMINI_API_KEY,
        prompt,
        aspectRatio,
        modelName: provider.model,
      });
    } else if (provider.provider === "bfl") {
      if (!process.env.BFL_API_KEY) {
        throw new Error("Missing BFL_API_KEY");
      }

      generated = await generateWithFlux2({
        apiKey: process.env.BFL_API_KEY,
        prompt,
        aspectRatio,
        endpoint: provider.endpoint,
      });
    } else {
      throw new Error("Unsupported provider");
    }

    const contentType = generated.contentType || "image/png";
    const ext = fileExtFromContentType(contentType);
    const fileName = safeName(`${model}_${aspectRatio}_${nowStamp()}.${ext}`);
    const outputPath = `tools/image-generate/${memberId}/${fileName}`;

    const uploadRes = await supabaseAdmin.storage
      .from(OUTPUT_BUCKET)
      .upload(outputPath, generated.buffer, {
        contentType,
        upsert: true,
      });

    if (uploadRes.error) {
      throw new Error(uploadRes.error.message || "Failed to upload generated image");
    }

    const signedOutput = await supabaseAdmin.storage
      .from(OUTPUT_BUCKET)
      .createSignedUrl(outputPath, 60 * 60 * 24);

    if (signedOutput.error || !signedOutput.data?.signedUrl) {
      throw new Error(
        signedOutput.error?.message || "Failed to create signed output URL"
      );
    }

    return json(res, 200, {
      ok: true,
      memberId,
      model,
      modelLabel: provider.label,
      aspectRatio,
      creditCost,
      outputBucket: OUTPUT_BUCKET,
      outputPath,
      fileName,
      contentType,
      downloadUrl: signedOutput.data.signedUrl,
    });
  } catch (err) {
    if (creditsDeducted && refundContext) {
      try {
        await addCredits(refundContext);
      } catch (refundErr) {
        console.error("tools-generate-image refund error:", refundErr);
      }
    }

    console.error("tools-generate-image error:", err);

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
      error: err.message || "Failed to generate image",
    });
  }
};
