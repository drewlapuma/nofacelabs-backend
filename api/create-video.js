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
    const { storyType, customPrompt, aspectRatio } = body;

    // Map aspect → template id from env
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    console.log("[CREATE_VIDEO] ENV", {
      apiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      have916: !!env916, have11: !!env11, have169: !!env169,
      templatePreview: template_id ? template_id.slice(0,6) + "…" : "none"
    });

    if (!process.env.CREATOMATE_API_KEY)
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!template_id)
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });

    // Modifications – selectors must match your template
    const modifications = {
      Headline: (customPrompt && customPrompt.trim())
        ? customPrompt.trim()
        : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920"
      // voice_url: body.voice_url   // only if your template has a layer with selector "voice_url"
    };

    // ---- SHAPE 1: single object, top-level format, source.template_id ----
    const payload1 = {
      format: "mp4",                  // force video AT TOP LEVEL
      source: {
        template_id,
        modifications
        // (do NOT put format/duration inside source for this attempt)
      }
    };

    // ---- SHAPE 2: array of that same object (some projects expect an array) ----
    const payload2 = [ payload1 ];

    async function send(label, payload) {
      console.log(`[CREATE_VIDEO] TRY ${label}:`, JSON.stringify(payload).slice(0, 600));
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
      console.log(`[CREATE_VIDEO] RESP ${label}:`, resp.status, JSON.stringify(data).slice(0, 800));
      return { ok: resp.ok, status: resp.status, data };
    }

    // Try SHAPE 1, then SHAPE 2 only if we get a 400
    let r = await send("SINGLE", payload1);
    if (!r.ok && r.status === 400) {
      r = await send("ARRAY", payload2);
    }

    if (!r.ok) {
      return res.status(r.status).json({ error: "CREATOMATE_ERROR", details: r.data });
    }

    // Extract job id (object or array)
    const data = r.data;
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
