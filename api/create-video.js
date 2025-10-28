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
      voice,       // kept for future
      language,    // kept for future
      durationSec,
      aspectRatio, // "9:16" | "1:1" | "16:9"
      artStyle     // kept for future
    } = body;

    // --- Choose template by aspect ---
    const aspect = (aspectRatio || "").trim();
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = templateMap[aspect];

    const apiKeyPresent = !!process.env.CREATOMATE_API_KEY;

    console.log("[CREATE_VIDEO] ENV", {
      apiKeyPresent,
      aspect,
      has916: !!env916, has11: !!env11, has169: !!env169,
      templatePreview: template_id ? template_id.slice(0, 6) + "…" : "none"
    });

    if (!apiKeyPresent) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!template_id)  return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });

    // --- Modifications (selectors must match your template) ---
    const headline = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : (storyType || "Sample Headline");
    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920",
      // voice_url: body.voice_url // only if your template has a layer with selector "voice_url"
    };

    // --- Force video intent ---
    const duration = Math.max(5, Number(durationSec) || 75); // never zero
    const baseRender = { format: "mp4", duration, frame_rate: 30 };

    // Four payload shapes, each includes mp4 + duration:
    const shapes = [
      {
        label: "B(array + source.template_id)",
        payload: [
          { ...baseRender, source: { template_id, modifications } }
        ]
      },
      {
        label: "D(single object + source.template_id)",
        payload: { ...baseRender, source: { template_id, modifications } }
      },
      {
        label: "C(object + renders[])",
        payload: { renders: [ { ...baseRender, template_id, modifications } ] }
      },
      {
        label: "A(array + template_id)",
        payload: [ { ...baseRender, template_id, modifications } ]
      },
    ];

    async function trySend(label, payload) {
      console.log(`[CREATE_VIDEO] TRY ${label}`, JSON.stringify(payload).slice(0, 400));
      const r = await fetch("https://api.creatomate.com/v1/renders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload),
      });
      const raw = await r.text();
      let data; try { data = JSON.parse(raw); } catch { data = { raw }; }
      console.log(`[CREATE_VIDEO] RESP ${label}`, r.status, JSON.stringify(data).slice(0, 600));
      return { ok: r.ok, status: r.status, data, label };
    }

    // try shapes in order; stop on first success
    let last = null, result = null;
    for (const { label, payload } of shapes) {
      last = await trySend(label, payload);
      if (last.ok) { result = last; break; }
      if (last.status !== 400) break; // non-400 => don’t keep guessing, return it
    }

    if (!result || !result.ok) {
      const out = last || { status: 500, data: { error: "UNKNOWN" } };
      console.error("[CREATOMATE_ERROR]", { from: out.label, status: out.status, body: out.data });
      return res.status(out.status || 500).json({ error: "CREATOMATE_ERROR", details: out.data });
    }

    const json = result.data;
    // When we POST an array, Creatomate returns an array
    const job_id = Array.isArray(json) ? (json[0]?.id || json[0]?.job_id) : (json?.id || json?.job_id);
    if (!job_id) {
      console.error("[CREATE_VIDEO] NO_JOB_ID_IN_RESPONSE", json);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: json });
    }

    return res.status(200).json({ ok: true, job_id, shape: result.label });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
