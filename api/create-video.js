// api/create-video.js  (CommonJS for Vercel)
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
    const { storyType, customPrompt, voice, language, durationSec, aspectRatio, artStyle } = body;

    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV_STATUS", {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      template_id_preview: template_id ? template_id.slice(0,6) + "…" : "none"
    });

    if (!process.env.CREATOMATE_API_KEY) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!template_id) return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });

    // --- Modifications (matches your Creatomate template selectors) ---
    const modifications = {
      Headline: customPrompt?.trim() || storyType || "Sample Headline",
      image_url: "https://picsum.photos/1080/1920"
    };

    // --- Payload: single render request ---
    const payload = [
      {
        template_id,
        modifications,
        format: "mp4",         // force mp4
        output_format: "mp4",  // redundant but safe
        duration: durationSec || 75
      }
    ];

    console.log("[CREATE_VIDEO] PAYLOAD", JSON.stringify(payload, null, 2));

    // --- Send to Creatomate ---
    const resp = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    console.log("[CREATE_VIDEO] RESP", resp.status, JSON.stringify(json, null, 2));

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: json });
    }

    const job_id = Array.isArray(json) ? json[0]?.id : json?.id;
    if (!job_id) {
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: json });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
