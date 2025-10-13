 // api/create-video.js  (CommonJS)

// --- simple CORS (kept minimal) ---
const allowOrigin = process.env.ALLOW_ORIGIN || "*";
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// map aspect -> template env
function pickTemplate(aspect) {
  const a = (aspect || "").trim();
  if (a === "9:16") return process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919; // support your older name
  if (a === "1:1")  return process.env.CREATO_TEMPLATE_11;
  if (a === "16:9") return process.env.CREATO_TEMPLATE_169;
  return null;
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")  return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    // Vercel parses JSON for us; if a string sneaks through, parse it.
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const {
      storyType,
      customPrompt,
      voice,
      language,
      durationSec = 60,
      aspectRatio = "9:16",
      artStyle
    } = body;

    // choose Creatomate template
    const template_id = pickTemplate(aspectRatio);
    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "NO_CREATOMATE_API_KEY" });
    }
    if (!template_id) {
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspectRatio });
    }

    // You can replace these with your real dynamic values
    const modifications = {
      Headline: customPrompt && customPrompt.trim() ? customPrompt : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
      voice_url: null
    };

    // Call Creatomate using the **built-in** fetch (no node-fetch!)
    const resp = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
        "Content-Type": "application/json"
      },
      // Creatomate accepts either `{ template_id, modifications }`
      // or `{ source: { template_id, modifications } }`. Both work; we'll use the short one:
      body: JSON.stringify([{ template_id, modifications }]) // array => multiple renders supported
    });

    const json = await resp.json();

    if (!resp.ok) {
      // bubble up Creatomate's helpful error
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: json });
    }

    // Creatomate returns an array; each item has an id (job id)
    const job_id = Array.isArray(json) ? json[0]?.id : json?.id || json?.job_id;
    if (!job_id) {
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", raw: json });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] ERROR", err);
    return res.status(500).json({ error: "CREATE_VIDEO_CRASH", message: err.message });
  }
};
