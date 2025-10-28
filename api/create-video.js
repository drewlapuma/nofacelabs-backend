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
  if (req.method !== "POST")  return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { storyType, customPrompt, durationSec, aspectRatio } = body;

    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    if (!template_id) {
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    const headline = (customPrompt && customPrompt.trim())
      ? customPrompt.trim()
      : (storyType || "Sample Headline");

    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920",
    };

    // IMPORTANT: use output_format (not format) + duration at the top level
    const payload = [{
      output_format: "mp4",
      duration: Math.max(1, Number(durationSec || 75)), // seconds
      source: {
        template_id,
        modifications,
      }
      // you can also send width/height/framerate here if you need
    }];

    console.log("[CREATE_VIDEO] PAYLOAD_PREVIEW", JSON.stringify({
      item_count: payload.length,
      first: { output_format: payload[0].output_format, duration: payload[0].duration, template_id: template_id?.slice(0,6)+"…" }
    }));

    const resp = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log("[CREATE_VIDEO] RESP", resp.status, JSON.stringify(data).slice(0,500));

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: data });
    }

    const job_id = Array.isArray(data) ? data[0]?.id : (data?.id || data?.job_id);
    if (!job_id) {
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: data });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
