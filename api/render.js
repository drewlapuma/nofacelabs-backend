// api/render.js (CommonJS)
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
    const id = String(req.query?.id || "").trim();
    if (!id) return res.status(400).json({ error: "MISSING_ID" });

    const sb = getAdminSupabase();
    const { data, error } = await sb
      .from("renders")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ error: "NOT_FOUND" });
    if (data.member_id !== member_id) return res.status(403).json({ error: "FORBIDDEN" });

    return res.status(200).json({ ok: true, item: data });
  } catch (err) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
};
