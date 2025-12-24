// api/submagic-templates.js (CommonJS, Node 18)

const SUBMAGIC_BASE = "https://api.submagic.co/v1";

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

function normalizeTemplates(raw) {
  // Submagic might return { templates: [...] } or just [...]
  const arr =
    Array.isArray(raw) ? raw :
    Array.isArray(raw?.templates) ? raw.templates :
    Array.isArray(raw?.data) ? raw.data :
    [];

  return arr
    .map((t) => ({
      id: String(t?.id || t?.templateId || t?.slug || t?.name || "").trim(),
      name: String(t?.name || t?.title || t?.displayName || t?.slug || t?.id || "Template").trim(),
      // optional extras if they exist (won't break anything)
      preview: t?.preview || t?.thumbnail || t?.cover || "",
      category: t?.category || "",
    }))
    .filter((t) => t.id);
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const key = String(process.env.SUBMAGIC_API_KEY || "").trim();
    if (!key) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const r = await fetch(`${SUBMAGIC_BASE}/templates`, {
      headers: {
        // ✅ correct header
        "x-api-key": key,
        "Accept": "application/json",
      },
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: "SUBMAGIC_TEMPLATES_FAILED",
        status: r.status,
        details: j,
      });
    }

    const templates = normalizeTemplates(j);

    return res.status(200).json({
      ok: true,
      templates,       // ✅ [{id,name,preview,category}]
      rawCount: Array.isArray(j) ? j.length : (j?.templates?.length || j?.data?.length || null),
      count: templates.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
