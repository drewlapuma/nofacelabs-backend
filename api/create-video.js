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
    // Parse body safely whether Webflow sends JSON string or object
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const {
      storyType,
      customPrompt,
      voice,
      language,
      durationSec,
      aspectRatio,  // "9:16" | "1:1" | "16:9"
      artStyle
    } = body;

    console.log("[CREATE_VIDEO] INPUT", {
      storyType, voice, language, durationSec, aspectRatio, artStyle
    });

    // Pick template id by aspect ratio
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919; // safety
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

    // Your template’s selectors must match these keys in the editor:
    // Text layer -> Selector: Headline
    // Image layer -> Selector: image_url
    // (Optional) Audio layer -> Selector: voice_url
    const modifications = {
      Headline: customPrompt?.trim()
        ? customPrompt.trim()
        : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
    };
    // Only include voice_url if you really have an audio layer with that selector
    if (body.voice_url) {
      modifications.voice_url = body.voice_url;
    }

    // Creatomate request payload
    const payload = {
      source: { template_id, modifications },
    };

    console.log("[CREATE_VIDEO] CALL_PAYLOAD", { aspect, templateId: template_id });

    // Node 18+ on Vercel has fetch built-in; no node-fetch needed.
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

    // Creatomate can return either an array of jobs or a single job object
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

