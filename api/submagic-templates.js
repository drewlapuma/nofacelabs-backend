// api/submagic-templates.js (CommonJS, Node 18)

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function readJsonSafe(r) {
  try {
    return await r.json();
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const key = String(process.env.SUBMAGIC_API_KEY || "").trim();
    if (!key) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const url = "https://api.submagic.co/v1/templates";

    // Try the most common auth schemes (Submagic varies by account/API key type)
    const attempts = [
      { name: "auth_bearer", headers: { Authorization: `Bearer ${key}` } },
      { name: "auth_raw", headers: { Authorization: key } },
      { name: "x_api_key", headers: { "x-api-key": key } },
      { name: "X_API_Key", headers: { "X-API-Key": key } },
    ];

    let lastStatus = 0;
    let lastBody = {};

    for (const a of attempts) {
      const r = await fetch(url, { headers: a.headers });
      const j = await readJsonSafe(r);

      if (r.ok) {
        const list =
          (Array.isArray(j?.templates) && j.templates) ||
          (Array.isArray(j) && j) ||
          [];

        const templates = list
          .map((t) => {
            if (typeof t === "string") {
              const name = t.trim();
              return name ? { value: name, label: name } : null;
            }
            const value = String(t?.id || t?.name || t?.slug || t?.key || "").trim();
            const label = String(t?.name || t?.title || t?.label || value || "Template").trim();
            if (!value && !label) return null;
            return { value: value || label, label };
          })
          .filter(Boolean);

        return res.status(200).json({
          ok: true,
          templates,
          auth_used: a.name, // ✅ tells you what worked, without exposing the key
          raw: j,
        });
      }

      lastStatus = r.status;
      lastBody = j;
    }

    // If we got here, ALL auth attempts failed
    return res.status(lastStatus || 502).json({
      ok: false,
      error: "SUBMAGIC_TEMPLATES_FAILED",
      tried: attempts.map((a) => a.name),
      status: lastStatus,
      details: lastBody,
      hint:
        "Submagic rejected the API key with all common header formats. Verify the key value + whether Submagic expects a different header or endpoint for your plan.",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
