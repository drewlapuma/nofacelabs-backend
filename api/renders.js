// api/renders.js (CommonJS) — COMBINED list + single
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

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const id = String(req.query?.id || "").trim();

    // ✅ If id provided => return single item (replaces /api/render)
    if (id) {
      const { data, error: dbErr } = await sb
        .from("renders")
        .select(
          [
            "id",
            "created_at",
            "status",
            "video_url",
            "render_id",
            "choices",
            "error",

            // ✅ your REAL caption columns from Supabase screenshot
            "caption_status",
            "caption_error",
            "submagic_proj",
            "captioned_vide",
            "caption_templ",
          ].join(", ")
        )
        .eq("id", id)
        .eq("member_id", member_id)
        .single();

      if (dbErr || !data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

      return res.status(200).json({ ok: true, item: data });
    }

    // ✅ Otherwise => list (same as old /api/renders)
    const { data, error } = await sb
      .from("renders")
      .select(
        [
          "id",
          "created_at",
          "status",
          "video_url",
          "render_id",
          "choices",
          "error",

          "caption_status",
          "caption_error",
          "submagic_proj",
          "captioned_vide",
          "caption_templ",
        ].join(", ")
      )
      .eq("member_id", member_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED" });

    return res.status(200).json({ ok: true, items: data || [] });
  } catch (err) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: String(err?.message || err) });
  }
};
