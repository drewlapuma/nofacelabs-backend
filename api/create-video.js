// api/create-video.js
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
    const { storyType, customPrompt, durationSec, aspectRatio } = body;

    const apiKey = (process.env.CREATOMATE_API_KEY || "").trim();
    if (!apiKey) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });

    const env916 = (process.env.CREATO_TEMPLATE_916 || "").trim();
    const env11  = (process.env.CREATO_TEMPLATE_11  || "").trim();
    const env169 = (process.env.CREATO_TEMPLATE_169 || "").trim();

    const aspect = (aspectRatio || "").trim();
    const template_id =
      (aspect === "9:16" && env916) || (aspect === "1:1" && env11) || (aspect === "16:9" && env169) || env916;

    if (!template_id) return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });

    const duration = Math.max(1, Number(durationSec || 75));
    const headline = (customPrompt?.trim()) || storyType || "Sample Headline";

    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920"
    };

    async function post(label, payload) {
      const bodyStr = JSON.stringify(payload);
      console.log(`[CREATE_VIDEO] SENT ${label}`, bodyStr);
      const r = await fetch("https://api.creatomate.com/v1/renders", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: bodyStr
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      console.log(`[CREATE_VIDEO] RESP ${label}`, r.status, JSON.stringify(data).slice(0,600));
      return { ok: r.ok, status: r.status, data };
    }

    // Shape A: array of jobs, top-level template_id + format + duration
    const shapeA = [{
      template_id,
      modifications,
      format: "mp4",
      duration
    }];
    let resp = await post("shapeA(array+template_id)", shapeA);

    // Shape B: wrapper object with renders: [ … ]
    if (!resp.ok && resp.status === 400) {
      const shapeB = {
        renders: [{
          template_id,
          modifications,
          format: "mp4",
          duration
        }]
      };
      resp = await post("shapeB(wrapper+renders[])", shapeB);
    }

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: resp.data });
    }

    const d = resp.data;
    const job_id = Array.isArray(d) ? (d[0]?.id || d[0]?.job_id) : (d?.id || d?.job_id);
    if (!job_id) return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: d });

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
