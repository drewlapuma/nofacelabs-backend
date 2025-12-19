// api/renders.js (CommonJS)
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const { data, error } = await sb
      .from("renders")
      .select("id, created_at, status, video_url, render_id, choices, error")
      .eq("member_id", member_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[SUPABASE] list error", error);
      return res.status(500).json({ error: "SUPABASE_LIST_FAILED" });
    }

    return res.status(200).json({ ok: true, items: data || [] });
  } catch (err) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
};
