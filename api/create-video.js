// api/create-video.js  (CommonJS on Vercel)
// package.json should be: { "type": "commonjs" }

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const {
      storyType,
      customPrompt,
      voice,        // not used directly
      language,     // available for future branching
      durationSec,  // available for future branching
      aspectRatio,  // "9:16" | "1:1" | "16:9"
      artStyle
    } = body;

    console.log("[CREATE_VIDEO] INPUT", {
      storyType, voice, language, durationSec, aspectRatio, artStyle
    });

    const aspect = String(aspectRatio || "").trim().replace("x", ":");

    // env template ids
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;

    const templateMap = {
      "9:16": env916,
      "1:1":  env11,
      "16:9": env169,
    };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV_STATUS", {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      env916: env916 ? "set" : "missing",
      env11:  env11  ? "set" : "missing",
      env169: env169 ? "set" : "missing",
    });

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    if (!template_id) {
      console.error("[CREATE_VIDEO] missing template for aspect", aspect);
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    // selectors must exist in the template
    const modifications = {
      Headline: (customPrompt && customPrompt.trim())
        ? customPrompt.trim()
        : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
    };
    if (body.voice_url) {
      modifications.voice_url = body.voice_url;
    }

    // === IMPORTANT: array payload, with top-level format: 'mp4' AND source{...} ===
const payload = [
  {
    format: "mp4",                    // forces video
    // frame_rate: 30,               // optional
    // snapshot: false,              // optional safety (defaults false for mp4)
    source: {
      template_id,
      modifications,
    },
  }
];


    console.log("[CREATE_VIDEO] CALL_PAYLOAD_META", { aspect, templateId: template_id });

    const resp = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawText = await resp.text();
    let respJson;
    try { respJson = JSON.parse(rawText); } catch { respJson = { raw: rawText }; }

    // Helpful diagnostics in logs:
    console.log("[CREATE_VIDEO] RAW_RESPONSE", rawText);

    if (!resp.ok) {
      console.error("[CREATOMATE_ERROR]", {
        status: resp.status,
        body: respJson,
        sent: payload,
      });
      return res.status(resp.status).json({
        error: "CREATOMATE_ERROR",
        status: resp.status,
        details: respJson,
      });
    }

    // Array response -> first job’s id
    const job_id = Array.isArray(respJson)
      ? respJson[0]?.id
      : (respJson?.id || respJson?.job_id);

    if (!job_id) {
      console.error("[CREATE_VIDEO] No job id in response", respJson);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: respJson });
    }

    return res.status(200).json({ ok: true, job_id });

  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};

