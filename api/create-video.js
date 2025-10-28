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

    const duration = Math.max(1, Number(durationSec || 75));
    const headline = (customPrompt && customPrompt.trim())
      ? customPrompt.trim()
      : (storyType || "Sample Headline");

    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920",
    };

    // ---- Shape 1: TOP-LEVEL template_id (most compatible)
    const payload1 = [{
      template_id,                 // <— at top level
      modifications,
      output_format: "mp4",
      duration                     // timeline duration in seconds
    }];

    const resp1 = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload1),
    });

    let text1 = await resp1.text();
    let data1; try { data1 = JSON.parse(text1); } catch { data1 = { raw: text1 }; }
    console.log("[CREATE_VIDEO] SENT shape1", JSON.stringify(payload1));
    console.log("[CREATE_VIDEO] RESP shape1", resp1.status, JSON.stringify(data1).slice(0, 500));

    if (resp1.ok) {
      const job_id = Array.isArray(data1) ? data1[0]?.id : (data1?.id || data1?.job_id);
      if (!job_id) return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: data1 });
      return res.status(200).json({ ok: true, job_id });
    }

    // ---- Shape 2: source.template_id fallback
    const payload2 = [{
      output_format: "mp4",
      duration,
      source: {
        template_id,               // <— inside source
        modifications,
      }
    }];

    const resp2 = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload2),
    });

    let text2 = await resp2.text();
    let data2; try { data2 = JSON.parse(text2); } catch { data2 = { raw: text2 }; }
    console.log("[CREATE_VIDEO] SENT shape2", JSON.stringify(payload2));
    console.log("[CREATE_VIDEO] RESP shape2", resp2.status, JSON.stringify(data2).slice(0, 500));

    if (!resp2.ok) {
      return res.status(resp2.status).json({ error: "CREATOMATE_ERROR", details: data2 });
    }

    const job_id = Array.isArray(data2) ? data2[0]?.id : (data2?.id || data2?.job_id);
    if (!job_id) return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: data2 });
    return res.status(200).json({ ok: true, job_id });

  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
