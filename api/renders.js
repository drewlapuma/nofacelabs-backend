// api/renders.js (CommonJS) — COMBINED list + single (schema-tolerant)
// GET /api/renders              => list
// GET /api/renders?id=<uuid>    => single

const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

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

// ✅ Normalize DB row fields to the names your frontend expects
function normalizeRow(r) {
  const row = r || {};

  // Submagic project id (try multiple possible column spellings)
  const submagic_project_id =
    row.submagic_project_id ??
    row.submagic_proj_id ??
    row.submagic_proj ??
    row.submagic_proi ?? // seen in truncated UI earlier
    row.gic_project_id ?? // what the UI shows when truncated
    null;

  // Captioned video url
  const captioned_video_url =
    row.captioned_video_url ??
    row.captioned_vide ?? // truncated-looking name
    row.captioned_video ??
    null;

  // Caption template id
  const caption_template_id =
    row.caption_template_id ??
    row.caption_templ ?? // truncated-looking name
    row.caption_template ??
    null;

  return {
    ...row,

    // overwrite / provide the normalized keys
    submagic_project_id,
    captioned_video_url,
    caption_template_id,
  };
}

function sbErrShape(e) {
  if (!e) return null;
  return { message: e.message, details: e.details, hint: e.hint, code: e.code };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const id = String(req.query?.id || "").trim();

    // ✅ single (replaces /api/render)
    if (id) {
      const { data, error: dbErr } = await sb
        .from("renders")
        .select("*")
        .eq("id", id)
        .eq("member_id", member_id)
        .single();

      if (dbErr || !data) {
        console.error("[RENDERS_SINGLE] supabase error:", dbErr);
        return res.status(404).json({ ok: false, error: "NOT_FOUND", supabase: sbErrShape(dbErr) });
      }

      return res.status(200).json({ ok: true, item: normalizeRow(data) });
    }

    // ✅ list
    const { data, error } = await sb
      .from("renders")
      .select("*")
      .eq("member_id", member_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[RENDERS_LIST] supabase error:", error);
      return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED", supabase: sbErrShape(error) });
    }

    return res.status(200).json({ ok: true, items: (data || []).map(normalizeRow) });
  } catch (err) {
    const msg = String(err?.message || err);
    console.error("[RENDERS] ERROR:", err);

    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: msg });
    }

    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: msg });
  }
};
