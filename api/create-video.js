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
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const {
      storyType, customPrompt, durationSec,
      aspectRatio // expected: "9:16" | "1:1" | "16:9"
    } = body;

    const apiKey = (process.env.CREATOMATE_API_KEY || "").trim();
    if (!apiKey) return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });

    // --- TEMPLATE PICKING ---
    const env916 = (process.env.CREATO_TEMPLATE_916 || "").trim();
    const env11  = (process.env.CREATO_TEMPLATE_11  || "").trim();
    const env169 = (process.env.CREATO_TEMPLATE_169 || "").trim();

    const aspect = (aspectRatio || "").trim();
    const map = { "9:16": env916, "1:1": env11, "16:9": env169 };

    // 1) normal: from aspect
    let template_id = map[aspect];

    // 2) fallback: if aspect missing, try a default (9:16)
    if (!template_id) template_id = env916;

    // 3) emergency hard-force (for debugging): put a literal ID here temporarily
    // const FORCE_TEMPLATE_ID = "f7c4a58b-0499-41d5-a33f-2c77c482e6f2";
    // if (FORCE_TEMPLATE_ID) template_id = FORCE_TEMPLATE_ID;

    if (!template_id) {
      return res.status(400).json({
        error: "NO_TEMPLATE_ID_AVAILABLE",
        note: "Set CREATO_TEMPLATE_916/_11/_169 in Vercel and/or pass aspectRatio"
      });
    }

    const duration = Math.max(1, Number(durationSec || 75));
    const headline = (customPrompt?.trim()) || storyType || "Sample Headline";
    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920"
    };

    // OPTIONAL tag fallback (only used if both shapes 400)
    const tag916 = (process.env.CREATO_TAG_916 || "").trim();
    const tag11  = (process.env.CREATO_TAG_11  || "").trim();
    const tag169 = (process.env.CREATO_TAG_169 || "").trim();
    const tagMap = { "9:16": tag916, "1:1": tag11, "16:9": tag169 };
    const tag = tagMap[aspect];

    async function postToCreatomate(label, payload) {
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
      console.log(`[CREATE_VIDEO] RESP ${label}`, r.status, JSON.stringify(data).slice(0, 600));
      return { ok: r.ok, status: r.status, data, sent: bodyStr };
    }

    // ---- SHAPE 1: top-level template_id (array) ----
    const shape1 = [{
      template_id,
      modifications,
      output_format: "mp4",
      duration
    }];
    let resp = await postToCreatomate("shape1(template_id)", shape1);

    // ---- SHAPE 2: source.template_id (array) ----
    if (!resp.ok && resp.status === 400) {
      const shape2 = [{
        output_format: "mp4",
        duration,
        source: { template_id, modifications }
      }];
      resp = await postToCreatomate("shape2(source.template_id)", shape2);
    }

    // ---- SHAPE 3: tags (array) ----
    if (!resp.ok && resp.status === 400 && tag) {
      const shape3 = [{
        tags: [tag],
        modifications,
        output_format: "mp4",
        duration
      }];
      resp = await postToCreatomate("shape3(tags)", shape3);
    }

    if (!resp.ok) {
      // Bubble up the last attempt with exactly what we sent
      return res.status(resp.status).json({
        error: "CREATOMATE_ERROR",
        details: resp.data,
        sent: resp.sent
      });
    }

    const d = resp.data;
    const job_id = Array.isArray(d) ? (d[0]?.id || d[0]?.job_id) : (d?.id || d?.job_id);
    if (!job_id) {
      return res.status(502).json({ error: "NO_JOB_ID_IN_RESPONSE", details: d });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error("[CREATE_VIDEO] SERVER_ERROR", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: err.message });
  }
};
