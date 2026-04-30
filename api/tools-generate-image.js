// api/tools-generate-image.js
// CommonJS, Node 18+
// No SDK dependency required for Google image generation.
// - Nano Banana -> Google REST generateContent
// - Imagen 4 -> Google REST predict
// - FLUX.2 -> Black Forest Labs async API
// Skeleton references only apply when request body includes referenceImages.

const { createClient } = require("@supabase/supabase-js");
const {
  getImageCredits,
  deductCredits,
  addCredits
} = require("../_lib/credits");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SUPPORTED_MODELS = {
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

function getReferenceImagesFromBody(body) {
  if (!Array.isArray(body.referenceImages)) return [];

  return body.referenceImages
    .map((url) => String(url || "").trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 4);
}

function buildReferenceAwarePrompt(prompt, referenceImages) {
  if (!referenceImages.length) return prompt;

  return [
    prompt,
    "",
    "Use the attached skeleton reference images as the consistent main character design.",
    "Keep the same skull shape, body proportions, realistic skeleton structure, and overall character identity across scenes.",
    "Do not create a generic different skeleton. Preserve the built-in reference character while adapting pose, outfit, accessories, and environment to this scene.",
    "Generate a realistic vertical 9:16 cinematic image."
  ].join("\n");
}

async function imageUrlToGeminiPart(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load reference image: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = res.headers.get("content-type") || "image/png";

  return {
    inlineData: {
      mimeType,
      data: buffer.toString("base64"),
    },
  };
}

async function generateWithNanoBanana({
  apiKey,
  prompt,
  aspectRatio,
  modelName,
  referenceImages = []
}) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;

  const imageParts = [];
  for (const url of referenceImages) {
    imageParts.push(await imageUrlToGeminiPart(url));
  }

  const finalPrompt = buildReferenceAwarePrompt(prompt, referenceImages);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            ...imageParts,
            { text: finalPrompt }
          ],
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
      instances: [{ prompt }],
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
    throw new Error(
      createData?.error ||
      createData?.message ||
      `FLUX.2 request failed: HTTP ${createRes.status}`
    );
  }

  const pollingUrl = createData.polling_url;
  const startedAt = Date.now();

  while (Date.now() - startedAt < 120000) {
    await sleep(1500);

    const pollRes = await fetch(pollingUrl, {
      headers: { accept: "application/json", "x-key": apiKey },
    });

    const pollData = await pollRes.json().catch(() => null);

    if (!pollRes.ok) {
      throw new Error(
        pollData?.error ||
        pollData?.message ||
        `FLUX.2 polling failed`
      );
    }

    const status = String(pollData?.status || "").toLowerCase();

    if (status === "ready") {
      return downloadToBuffer(pollData.result.sample, { "x-key": apiKey });
    }

    if (status === "failed") {
      throw new Error("FLUX.2 generation failed");
    }
  }

  throw new Error("FLUX.2 timed out");
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  if (req.method !== "POST") return json(res, 405, { ok: false });

  let creditsDeducted = false;
  let creditCost = 0;
  let refundContext = null;

  try {
    const body = await readJson(req);

    const memberId = safeSegment(
      body.memberId || req.headers["x-nf-member-id"] || "anonymous"
    );

    const prompt = String(body.prompt || "").trim();
    const model = String(body.model || "").trim();
    const aspectRatio = String(body.aspectRatio || "1:1");

    const referenceImages = getReferenceImagesFromBody(body);

    if (!SUPPORTED_MODELS[model]) {
      return json(res, 400, { ok: false, error: "Invalid model" });
    }

    if (!SUPPORTED_ASPECT_RATIOS.has(aspectRatio)) {
      return json(res, 400, { ok: false, error: "Invalid aspect ratio" });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const OUTPUT_BUCKET = process.env.SUPABASE_TOOL_OUTPUTS_BUCKET || "tool-outputs";

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const provider = SUPPORTED_MODELS[model];
    creditCost = getImageCredits(model);

    refundContext = {
      supabaseAdmin,
      memberId,
      amount: creditCost,
      reason: "image_generation_refund",
    };

    await deductCredits({
      supabaseAdmin,
      memberId,
      amount: creditCost,
      reason: "image_generation",
      toolType: "image_generate",
      model,
    });

    creditsDeducted = true;

    let generated;

    if (provider.provider === "google-gemini") {
      generated = await generateWithNanoBanana({
        apiKey: process.env.GEMINI_API_KEY,
        prompt,
        aspectRatio,
        modelName: provider.model,
        referenceImages, // 🔥 ONLY applied when present
      });
    } else if (provider.provider === "google-imagen") {
      generated = await generateWithImagen({
        apiKey: process.env.GEMINI_API_KEY,
        prompt,
        aspectRatio,
        modelName: provider.model,
      });
    } else {
      generated = await generateWithFlux2({
        apiKey: process.env.BFL_API_KEY,
        prompt,
        aspectRatio,
        endpoint: provider.endpoint,
      });
    }

    const contentType = generated.contentType || "image/png";
    const ext = fileExtFromContentType(contentType);
    const fileName = safeName(`${model}_${nowStamp()}.${ext}`);
    const outputPath = `tools/image-generate/${memberId}/${fileName}`;

    await supabaseAdmin.storage
      .from(OUTPUT_BUCKET)
      .upload(outputPath, generated.buffer, {
        contentType,
        upsert: true,
      });

    const signed = await supabaseAdmin.storage
      .from(OUTPUT_BUCKET)
      .createSignedUrl(outputPath, 86400);

    return json(res, 200, {
      ok: true,
      downloadUrl: signed.data.signedUrl,
      outputPath,
    });

  } catch (err) {
    if (creditsDeducted && refundContext) {
      await addCredits(refundContext);
    }

    console.error("tools-generate-image error:", err);

    return json(res, 500, {
      ok: false,
      error: err.message,
    });
  }
};
