// api/create-video.js  (CommonJS on Vercel)
// package.json should be { "type": "commonjs" }

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
    const {
      storyType,
      customPrompt,
      voice,          // not used yet, but keep for future
      language,       // not used yet, but keep for future
      durationSec,    // expect a number like 60-90
      aspectRatio,    // "9:16" | "1:1" | "16:9"
      artStyle        // not used yet, but keep for future
    } = body;

    // --- pick template by aspect ---
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV_STATUS", {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      env916: !!env916, env11: !!env11, env169: !!env169,
      template_id_preview: template_id ? template_id.slice(0, 6) + "…" : "none"
    });

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    if (!template_id) {
      console.error("[CREATE_VIDEO] missing template for aspect", aspect);
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    // --- modifications must match your template selectors exactly ---
    const headline = (customPrompt && customPrompt.trim())
      ? customPrompt.trim()
      : (storyType || "Sample Headline");

    const modifications = {
      Headline: headline,                 // text layer selector in your template
      image_url: "https://picsum.photos/1080/1920", // image/media selector in your template
      // If you really have an audio layer named "voice_url", include it here:
      // voice_url: body.voice_url
    };

    // --- force a video export (mp4) with a real timeline ---
    const duration = Math.max(5, Number(durationSec) || 75); // never 0; default 75s

    // Creatomate expects an ARRAY of render objects
    // Put the video intent in both places (format + output.format) for compatibility.
    const payload = [
      {
        format: "mp4",
        duration,             // seconds (ensures it can't collapse to a JPG snapshot)
        frame_rate: 30,
        output: { format: "mp4" },
        source: {
          template_id,
          // composition: "Main", // uncomment if your template uses a named composition
          modifications
        }
      }
    ];

    console.log(
      "[CREATE_VIDEO] PAYLOAD_PREVIEW",
      { item_count: payload.length, format: payload[0].format, duration: payload[0].duration }
    );

    const resp = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const raw = await resp.text();
    let json; try { json = JSON.parse(raw); } catch { json = { raw }; }
    console.log("[CREATE_VIDEO] RESP", resp.status, JSON.stringify(json).slice(0, 900));

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: json });
    }

    // Creatomate returns an array when you POST an array
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
