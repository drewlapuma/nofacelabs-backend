// api/submagic-templates.js (CommonJS)
module.exports = async function handler(req, res) {
  const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
    .split(",").map(s => s.trim()).filter(Boolean);

  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const r = await fetch("https://api.submagic.co/v1/templates", {
      headers: {
        "x-api-key": SUBMAGIC_API_KEY, // ✅ match your other calls
      },
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, error: "SUBMAGIC_TEMPLATES_FAILED", details: j });

    // ✅ Normalize into simple options for UI
    const arr = Array.isArray(j) ? j : (j?.templates || j?.data || []);
    const templates = (Array.isArray(arr) ? arr : []).map(t => ({
      id: t.id || t.templateId || t.name,
      name: t.name || t.title || t.templateName || t.id || "Template",
    }));

    return res.status(200).json({ ok: true, templates });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
