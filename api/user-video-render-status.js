// api/user-video-render-status.js (CommonJS, Node 18+)
// GET /api/user-video-render-status?id=RENDER_ID
// Returns: { status, url, error }

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  // Helpful for caching issues during polling
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getIdFromReq(req) {
  // Vercel Node funcs usually provide req.query, but be defensive:
  const q = req.query || {};
  const id1 = q.id;
  if (id1) return String(id1).trim();

  try {
    const url = new URL(req.url, "http://localhost");
    return (url.searchParams.get("id") || "").trim();
  } catch {
    return "";
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "GET") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  const id = getIdFromReq(req);
  if (!id) return sendJson(res, 400, { error: "Missing id" });

  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  if (!CREATOMATE_API_KEY) {
    return sendJson(res, 500, { error: "Missing CREATOMATE_API_KEY env var" });
  }

  try {
    const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CREATOMATE_API_KEY}`,
        Accept: "application/json",
      },
    });

    const text = await r.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Creatomate should return JSON, but keep this safe
      data = { message: text };
    }

    if (!r.ok) {
      return sendJson(res, r.status, {
        error: data?.message || data?.error || "Status fetch failed",
        status: "failed",
      });
    }

    // Creatomate: status usually "queued" | "processing" | "succeeded" | "failed"
    const status = data.status || "unknown";

    // Some responses include `url`, others include `output` array. Be flexible.
    const url =
      data.url ||
      (Array.isArray(data.outputs) && data.outputs[0]?.url) ||
      (Array.isArray(data.output) && data.output[0]?.url) ||
      null;

    const errMsg = data.error || data.message || null;

    return sendJson(res, 200, {
      status,
      url,
      error: status === "failed" ? errMsg : null,
    });
  } catch (e) {
    return sendJson(res, 500, { error: e?.message || "Server error" });
  }
};
