// api/create-video.js  (CommonJS on Vercel)
// package.json => { "type": "commonjs" }

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Vary", "Origin");
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
      durationSec,
      aspectRatio,   // "9:16" | "1:1" | "16:9"
    } = body;

    // Map aspect -> template env var
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV", {
      apiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      has916: !!env916, has11: !!env11, has169: !!env169,
      templatePreview: template_id ? template_id.slice(0,6) + "…" : "none"
    });

    if (!process.env.CREATOMATE_API_KEY)
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!template_id)
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });

    // Build modifications (selectors must match your template)
    const headline = (customPrompt && customPrompt.trim())
      ? customPrompt.trim()
      : (storyType || "Sample Headline");

    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920",
      // voice_url: body.voice_url // only if your template has that selector
    };

    // Force video intent explicitly
    const duration = Math.max(5, Number(durationSec) || 75);

    // --- SINGLE, STRICT PAYLOAD (renders[]) ---
    const payload = {
      renders: [
        {
          format: "mp4",          // <— force video at item level
          duration,               // <— set a real timeline length
          frame_rate: 30,
          video_codec: "h264",
          // mirror in source as well, belt-and-suspenders
          source: {
            template_id,
            modifications,
            format: "mp4",
            duration
          }
        }
      ]
    };

    console.log("[CREATE_VIDEO] SENDING", JSON.stringify(payload).slice(0, 800));

    const resp = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();
    let data; try { data = JSON.parse(raw); } catch { data = { raw }; }
    console.log("[CREATE_VIDEO] RESP", resp.status, JSON.stringify(data).slice(0, 800));

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: data });
    }

    // With renders[], Creatomate returns an array
    const job_id = Array.isArray(data) ? (data[0]?.id || data[0]?.job_id) : (data?.id || data?.job_id);
    if (!job_id) {
      console.error("[CREATE_VIDEO] NO_JOB_ID_IN_RESPONSE", data);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: data });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
