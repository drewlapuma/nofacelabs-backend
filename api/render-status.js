// api/render-status.js (CommonJS)
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // Try to read job_id from query or JSON body
  let job_id = (req.query && req.query.job_id) || undefined;
  if (!job_id && req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      job_id = body.job_id;
    } catch (e) {
      // ignore JSON parse error, we'll handle missing job_id below
    }
  }

  console.log("[RENDER_STATUS] METHOD", req.method, "QUERY", req.query, "BODY", typeof req.body === "string" ? req.body : req.body);

  const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!job_id || !UUID_RX.test(job_id)) {
    console.error("RENDER_STATUS invalid job_id", job_id);
    return res.status(400).json({ error: "INVALID_JOB_ID", hint: "Pass job_id in ?job_id=... (GET) or {job_id} (POST)" });
  }

  if (!process.env.CREATOMATE_API_KEY) {
    return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
  }

  try {
    const resp = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(job_id)}`, {
      method: "GET",
      headers: { "Authorization": `Bearer ${process.env.CREATOMATE_API_KEY}` }
    });
    const text = await resp.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!resp.ok) {
      console.error("RENDER_STATUS Creatomate error:", data);
      return res.status(resp.status).json({ error: "CREATOMATE_ERROR", details: data });
    }

    const state = data.state || data.status || data.phase;
    const url   = data.render?.url || data.url || null;
    return res.status(200).json({ ok: true, job_id, state, url, raw: data });
  } catch (e) {
    console.error("RENDER_STATUS SERVER_ERROR", e);
    return res.status(500).json({ error: "SERVER_ERROR", message: e.message });
  }
};
