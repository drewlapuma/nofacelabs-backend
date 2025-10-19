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
      env11:  env11  ? "set" : "missing",
      env169: env169 ? "set" : "missing",
      template_id_preview: template_id ? template_id.slice(0,6) + "…" : "none"
    });

    if (!process.env.CREATOMATE_API_KEY) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    if (!template_id) {
      console.error("[CREATE_VIDEO] missing template for aspect", aspect);
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    const modifications = {
      Headline: (customPrompt && customPrompt.trim()) ? customPrompt.trim() : (storyType || "Sample Headline"),
      image_url: "https://picsum.photos/1080/1920",
    };
    if (body.voice_url) modifications.voice_url = body.voice_url;

    // Variants
    const itemTopLevel   = { format: "mp4", template_id, modifications };
    const itemWithSource = { format: "mp4", source: { template_id, modifications } };
    const shapeB = [ itemWithSource ];        // array + source.template_id  <-- try FIRST
    const shapeD = itemWithSource;            // single object (no array)
    const shapeC = { renders: [ itemTopLevel ] }; // object wrapper with renders[]
    const shapeA = [ itemTopLevel ];          // array + top-level template_id

    async function trySend(payload, label) {
      console.log(`[CREATE_VIDEO] TRY ${label}`, JSON.stringify(payload).slice(0,500));
      const resp = await fetch("https://api.creatomate.com/v1/renders", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      console.log(`[CREATE_VIDEO] RESP ${label}`, resp.status, JSON.stringify(json).slice(0,500));
      return { ok: resp.ok, status: resp.status, data: json };
    }

    // New order: B → D → C → A
    let attempt = await trySend(shapeB, "B(array+source.template_id)");
    if (!attempt.ok && attempt.status === 400) attempt = await trySend(shapeD, "D(single object + source.template_id)");
    if (!attempt.ok && attempt.status === 400) attempt = await trySend(shapeC, "C(object+renders[])");
    if (!attempt.ok && attempt.status === 400) attempt = await trySend(shapeA, "A(array+template_id)");

    if (!attempt.ok) {
      console.error("[CREATOMATE_ERROR]", { status: attempt.status, body: attempt.data });
      return res.status(attempt.status).json({ error: "CREATOMATE_ERROR", status: attempt.status, details: attempt.data });
    }

    const respJson = attempt.data;
    const job_id = Array.isArray(respJson)
      ? (respJson[0]?.id || respJson[0]?.job_id)
      : (respJson?.id || respJson?.job_id);

    if (!job_id) {
      console.error("[CREATE_VIDEO] No job id in response", respJson);
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: respJson });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
