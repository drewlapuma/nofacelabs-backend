// api/user-video-render-status.js (CommonJS, Node 18+)

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

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.end();
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });

  try {
    const id = (req.query?.id || "").toString().trim();
    if (!id) return json(res, 400, { error: "Missing id" });

    const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
    if (!CREATOMATE_API_KEY) return json(res, 500, { error: "Missing CREATOMATE_API_KEY env var" });

    // Creatomate status endpoint
    const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(res, r.status, { error: data?.message || "Status fetch failed", details: data });

    // Creatomate often uses: status + url (when done)
    return json(res, 200, {
      status: data.status,
      url: data.url || null,
      error: data.error || null,
      raw: data, // optional for debugging
    });
  } catch (e) {
    return json(res, 500, { error: e.message || "Server error" });
  }
};
