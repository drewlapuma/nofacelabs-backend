// api/renders.js (CommonJS)
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",").map(s => s.trim()).filter(Boolean);

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

    const { data, error } = await sb
      .from("renders")
      .select(`
        id,
        created_at,
        status,
        video_url,
        render_id,
        choices,
        error,
        caption_status,
        captioned_video_url,
        caption_error,
        submagic_project_id
      `)
      .eq("member_id", member_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED" });
    return res.status(200).json({ ok: true, items: data || [] });
  } catch (err) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: String(err.message || err) });
  }
};
