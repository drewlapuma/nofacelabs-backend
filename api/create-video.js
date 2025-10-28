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
    const { storyType, customPrompt, voice, language, durationSec, aspectRatio, artStyle } = body;

    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV_STATUS", {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      env916: env916 ? "set" : "missing",
      env11 : env11  ? "set" : "missing",
      env169: env169 ? "set" : "missing",
      template_id_preview: template_id ? template_id.slice(0,6) + "…" : "none"
    });

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    if (!template_id) {
      console.error("[CREATE_VIDEO] missing template for aspect", aspect);
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    const modifications = {
      // make sure these selector names match your template
      Headline: (customPrompt && customPrompt.trim()) ? customPrompt.trim() : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
    };
    if (body.voice_url) modifications.voice_url = body.voice_url;

    // --- Force a true video render ---
    const seconds = Number(durationSec) || 75; // pick 60–90 in your UI; default 75
    const payload = {
      format: "mp4",
      duration: seconds, // << crucial: prevents snapshot JPG
      fps: 30,           // optional, but reinforces “video”
      source: {
        template_id,
        modifications
      }
    };
    // You may also send as an array; either is valid:
    // const payload = [ { format: "mp4", duration: seconds, fps: 30, source: { template_id, modifications } } ];

    console.log("[CREATE_VIDEO] PAYLOAD_PREVIEW", {
      format: payload.format,
      duration: payload.duration,
      fps: payload.fps,
      has_template: !!template_id,
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

    const raw = await resp.text();
    let json; try { json = JSON.parse(raw); } catch { json = { raw }; }
    console.log("[CREATE_VIDEO] RESP", resp.status, Array.isArray(json) ? json[0] : json);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: json });
    }

    const job_id = Array.isArray(json) ? (json[0]?.id || json[0]?.job_id) : (json?.id || json?.job_id);
    if (!job_id) {
      console.error("[CREATE_VIDEO] NO_JOB_ID_IN_RESPONSE", json);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: json });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
