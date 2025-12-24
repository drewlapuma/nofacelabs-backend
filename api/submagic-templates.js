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

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    // Use whatever Submagic expects in YOUR account. (You previously used Bearer here.)
    const r = await fetch("https://api.submagic.co/v1/templates", {
      headers: { Authorization: `Bearer ${SUBMAGIC_API_KEY}` },
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ ok: false, error: "SUBMAGIC_TEMPLATES_FAILED", details: j });

    // Submagic seems to return: { templates: ["Sara","Daniel", ...] }
    const list =
      (Array.isArray(j?.templates) && j.templates) ||
      (Array.isArray(j) && j) ||
      [];

    const templates = list
      .map((t) => {
        // If it's already a string name
        if (typeof t === "string") {
          const name = t.trim();
          return name ? { value: name, label: name } : null;
        }

        // If it’s an object (future-proof)
        const value = (t?.id || t?.name || t?.slug || t?.key || "").toString().trim();
        const label = (t?.name || t?.title || t?.label || value || "Template").toString().trim();
        if (!value && !label) return null;

        return { value: value || label, label };
      })
      .filter(Boolean);

    return res.status(200).json({
      ok: true,
      templates,
      raw: j,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
