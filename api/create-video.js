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
      aspectRatio,   // "9:16" | "1:1" | "16:9"
      artStyle,
      voice_url,
    } = body;

    console.log("[CREATE_VIDEO] INPUT", {
      storyType, voice, language, durationSec, aspectRatio, artStyle
    });

    // Map aspect -> env template id
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919; // alias safety
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;

    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV_STATUS", {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      env916: env916 ? "set" : "missing",
      env11:  env11  ? "set" : "missing",
      env169: env169 ? "set" : "missing",
      template_id_preview: template_id ? (template_id.slice(0,6) + "…" + template_id.slice(-4)) : "undefined"
    });

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    if (!template_id || !/^[0-9a-f-]{36}$/i.test(template_id)) {
      console.error("[CREATE_VIDEO] NO_TEMPLATE_FOR_ASPECT", { aspect, template_id });
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    // Template selectors must match these keys in the editor:
    //   Headline, image_url, (optional) voice_url
    const modifications = {
      Headline: (customPrompt && customPrompt.trim())
        ? customPrompt.trim()
        : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
    };
    if (voice_url) modifications.voice_url = voice_url;

    // === Use RENDERS WRAPPER (some accounts require this shape) ===
    const payload = {
      renders: [
        {
          template_id,          // top-level template reference
          modifications,
          format: "mp4",        // force video
          // frame_rate: 30,    // optional
        }
      ]
    };

    // Safe preview (don’t log full headline)
    console.log("[CREATE_VIDEO] CALL_PAYLOAD_PREVIEW", {
      uses_wrapper: true,
      item_count: payload.renders.length,
      item0: {
        format: payload.renders[0].format,
        template_id_preview: template_id.slice(0,6) + "…" + template_id.slice(-4),
        has_voice_url: !!modifications.voice_url,
        headline_len: (modifications.Headline || "").length,
      }
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
        sent_wrapper: true,
        sent_first_item_preview: {
          format: payload.renders[0].format,
          template_id_preview: template_id.slice(0,6) + "…" + template_id.slice(-4),
        },
      });
      return res.status(resp.status).json({
        error: "CREATOMATE_ERROR",
        status: resp.status,
        details: respJson,
      });
    }

    // Wrapper response can come back as array or object
    // Normalize: find first job id
    let job_id = null;
    if (Array.isArray(respJson)) {
      job_id = respJson[0]?.id || respJson[0]?.job_id;
    } else if (respJson?.renders && Array.isArray(respJson.renders)) {
      job_id = respJson.renders[0]?.id || respJson.renders[0]?.job_id;
    } else {
      job_id = respJson?.id || respJson?.job_id;
    }

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
