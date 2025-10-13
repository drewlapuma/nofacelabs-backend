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

    // ----- Creatomate call with rich error logging -----
const payload = {
  // using object form instead of array (both are valid, but this is the simplest)
  source: { template_id, modifications },
};

const resp = await fetch("https://api.creatomate.com/v1/renders", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

// read body safely whether it's JSON or text
const rawText = await resp.text();
let respJson;
try { respJson = JSON.parse(rawText); } catch { respJson = { raw: rawText }; }

if (!resp.ok) {
  console.error("[CREATOMATE_ERROR]", {
    status: resp.status,
    body: respJson,
    sent: payload,
  });
  return res.status(resp.status).json({
    error: "CREATOMATE_ERROR",
    status: resp.status,
    details: respJson,
  });
}

// success
const job_id = Array.isArray(respJson) ? respJson[0]?.id : respJson?.id || respJson?.job_id;
if (!job_id) {
  console.error("[CREATE_VIDEO] No job id in response", respJson);
  return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: respJson });
}
return res.status(200).json({ ok: true, job_id });
