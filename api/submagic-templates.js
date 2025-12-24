// api/submagic-templates.js (CommonJS, Node 18)
// Returns Submagic caption templates with correct auth header (x-api-key) + optional mapping.
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

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const r = await fetch("https://api.submagic.co/v1/templates", {
      headers: {
        // ✅ FIX: Submagic uses x-api-key (matching your other Submagic calls)
        "x-api-key": SUBMAGIC_API_KEY,
      },
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, error: "SUBMAGIC_TEMPLATES_FAILED", details: j });

    // ✅ Return both raw + a normalized list (helps your Webflow dropdown)
    const raw = Array.isArray(j) ? j : (j?.templates && Array.isArray(j.templates) ? j.templates : j);

    const templates = (Array.isArray(raw) ? raw : []).map((t) => {
      const id = t?.id || t?.templateId || t?.template_id || t?.slug || t?.key || t?.name || t?.title || "";
      const name = t?.name || t?.title || t?.label || t?.displayName || t?.slug || id || "Template";
      return { id: String(id), name: String(name), raw: t };
    }).filter(x => x.id);

    return res.status(200).json({
      ok: true,
      templates,     // normalized: [{id, name, raw}]
      raw: j,        // full response in case you need extra fields later
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
