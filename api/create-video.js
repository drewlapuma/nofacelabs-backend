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
    // NOTE: env names are intentionally CREATO_* because that's how you set them in Vercel
    const env916 = process.env.CREATO_TEMPLATE_916 || process.env.CREATO_TEMPLATE_919;
    const env11  = process.env.CREATO_TEMPLATE_11;
    const env169 = process.env.CREATO_TEMPLATE_169;
    const templateMap = { "9:16": env916, "1:1": env11, "16:9": env169 };
    const template_id = (templateMap[aspect] || "").trim();

    const apiKey = (process.env.CREATOMATE_API_KEY || "").trim();

    console.log("[CREATE_VIDEO] ENV", {
      hasKey: !!apiKey, aspect,
      t916: !!env916, t11: !!env11, t169: !!env169,
      template_id_preview: template_id ? template_id.slice(0,6) + "…" : "none"
    });

    if (!apiKey) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }
    if (!template_id) {
      return res.status(400).json({ error: "NO_TEMPLATE_FOR_ASPECT", aspect });
    }

    const duration = Math.max(1, Number(durationSec || 75));
    const headline = (customPrompt && customPrompt.trim()) ? customPrompt.trim() : (storyType || "Sample Headline");

    const modifications = {
      Headline: headline,
      image_url: "https://picsum.photos/1080/1920"
    };

    async function post(label, payload) {
      console.log(`[CREATE_VIDEO] SENT ${label}`, JSON.stringify(payload));
      const r = await fetch("https://api.creatomate.com/v1/renders", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      console.log(`[CREATE_VIDEO] RESP ${label}`, r.status, JSON.stringify(data).slice(0,600));
      return { ok: r.ok, status: r.status, data };
    }

    // Shape #1 – top-level template_id
    const shape1 = [{
      template_id,
      modifications,
      output_format: "mp4",
      duration
    }];
    let resp = await post("shape1(template_id)", shape1);

    // Shape #2 – source.template_id
    if (!resp.ok && resp.status === 400) {
      const shape2 = [{
        output_format: "mp4",
        duration,
        source: { template_id, modifications }
      }];
      resp = await post("shape2(source.template_id)", shape2);
    }

    // Shape #3 – tags (fallback if template_id is being ignored)
    if (!resp.ok && resp.status === 400) {
      // In Creatomate editor, add a tag to this template, e.g. nf_916
      // Then set Vercel env CREATO_TAG_916="nf_916" (and _11, _169 if needed)
      const tag916 = process.env.CREATO_TAG_916 || "";
      const tag11  = process.env.CREATO_TAG_11 || "";
      const tag169 = process.env.CREATO_TAG_169 || "";
      const tagMap = { "9:16": tag916, "1:1": tag11, "16:9": tag169 };
      const tag = (tagMap[aspect] || "").trim();

      if (!tag) {
        console.warn("[CREATE_VIDEO] No tag fallback set for aspect", aspect);
      } else {
        const shape3 = [{
          tags: [tag],
          modifications,
          output_format: "mp4",
          duration
        }];
        resp = await post("shape3(tags)", shape3);
      }
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
