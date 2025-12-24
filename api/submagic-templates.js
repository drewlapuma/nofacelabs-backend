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

function toSlug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTemplates(any) {
  // Supports:
  // - { templates: [...] }
  // - [...]
  // - { raw: { templates: [...] } }
  const rawList =
    (any && Array.isArray(any.templates) ? any.templates : null) ||
    (any && any.raw && Array.isArray(any.raw.templates) ? any.raw.templates : null) ||
    (Array.isArray(any) ? any : null) ||
    [];

  // If Submagic gives strings like ["Sara","Daniel",...]
  if (rawList.length && typeof rawList[0] === "string") {
    return rawList
      .map((name) => {
        const n = String(name || "").trim();
        if (!n) return null;
        return { id: toSlug(n) || n, name: n };
      })
      .filter(Boolean);
  }

  // If Submagic gives objects
  return rawList
    .map((t) => {
      const name = String(t?.name || t?.title || t?.displayName || t?.slug || t?.id || "").trim();
      const id = String(t?.id || t?.templateId || t?.slug || toSlug(name) || name).trim();
      if (!id) return null;
      return { id, name: name || id };
    })
    .filter(Boolean);
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const key = String(process.env.SUBMAGIC_API_KEY || "").trim();
    if (!key) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    // ✅ Use x-api-key (matches your other Submagic calls)
    const r = await fetch(`${SUBMAGIC_BASE}/templates`, {
      headers: {
        "x-api-key": key,
        Accept: "application/json",
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
      templates, // ✅ now populated
      raw: j,    // keep raw for debugging
      count: templates.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
