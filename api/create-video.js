// api/create-video.js  (CommonJS on Vercel)

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      storyType,
      customPrompt,
      voice,
      language,
      durationSec,
      aspectRatio,  // "9:16" | "1:1" | "16:9"
      artStyle,
      voice_url,
    } = body;

    console.log("[CREATE_VIDEO] INPUT", {
      storyType, voice, language, durationSec, aspectRatio, artStyle
    });

    // Map aspect ratio -> template id from env
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919; // safety alias
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
      template_id_preview: template_id ? (template_id.slice(0, 6) + "…" + template_id.slice(-4)) : "undefined"
    });

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    // MUST be a UUID; otherwise Creatomate rejects the render item.
    if (!template_id || !/^[0-9a-f-]{36}$/.test(template_id)) {
      console.error("[CREATE_VIDEO] NO_TEMPLATE_FOR_ASPECT", { aspect, template_id });
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    // Your template’s Selectors must match these keys in the editor:
    // - Text layer:    Headline
    // - Image layer:   image_url
    // - (Optional) Audio layer: voice_url
    const modifications = {
      Headline: (customPrompt && customPrompt.trim()) ? customPrompt.trim() : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
    };
    if (voice_url) modifications.voice_url = voice_url;

    // === Array payload, item uses TOP-LEVEL template_id and format: 'mp4' ===
    const item = {
      template_id,
      modifications,
      format: "mp4",
      // frame_rate: 30,         // optional
      // snapshot: false,        // (applies to images; not needed for mp4)
    };
    const payload = [ item ];

    // Log a safe preview (without dumping full text)
    console.log("[CREATE_VIDEO] CALL_ITEM_PREVIEW", {
      format: item.format,
      template_id_preview: template_id.slice(0, 6) + "…" + template_id.slice(-4),
      has_voice_url: !!modifications.voice_url,
      headline_len: (modifications.Headline || "").length
    });

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
        sent: payload.map(p => ({
          format: p.format,
          template_id_preview: (p.template_id || "").slice(0, 6) + "…" + (p.template_id || "").slice(-4),
          has_source: !!p.source,
        })),
      });
      return res.status(resp.status).json({
        error: "CREATOMATE_ERROR",
        status: resp.status,
        details: respJson,
      });
    }

    // Array response → first job
    const job_id = Array.isArray(respJson)
      ? respJson[0]?.id
      : (respJson?.id || respJson?.job_id);

    if (!job_id) {
      console.error("[CREATE_VIDEO] NO_JOB_ID_IN_RESPONSE", respJson);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: respJson });
    }

    return res.status(200).json({ ok: true, job_id });

  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};

