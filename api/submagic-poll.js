// api/submagic-poll.js (CommonJS, Node 18)

const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

async function smGetProject(projectId) {
  const r = await fetch(`${SUBMAGIC_BASE}/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${SUBMAGIC_API_KEY}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_GET_FAILED (${r.status})`);
  return j;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id = String(body?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    const { data: row, error } = await sb
      .from("renders")
      .select("id, member_id, submagic_proj, caption_status, captioned_vide")
      .eq("id", id)
      .eq("member_id", member_id)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.submagic_proj) return res.status(400).json({ ok: false, error: "NO_SUBMAGIC_PROJECT" });

    // If already has caption URL, done.
    if (row.captioned_vide) return res.status(200).json({ ok: true, status: "completed", url: row.captioned_vide });

    const proj = await smGetProject(row.submagic_proj);

    // Try common fields Submagic might return
    const url =
      proj?.downloadUrl ||
      proj?.directUrl ||
      proj?.download_url ||
      proj?.direct_url ||
      "";

    const status = String(proj?.status || row.caption_status || "captioning");

    if (url) {
      await sb.from("renders").update({
        caption_status: "completed",
        captioned_vide: String(url),
        caption_error: null,
      }).eq("id", row.id);

      return res.status(200).json({ ok: true, status: "completed", url: String(url) });
    }

    // still working
    await sb.from("renders").update({
      caption_status: status,
    }).eq("id", row.id);

    return res.status(200).json({ ok: true, status });
  } catch (e) {
    // record error for UI
    try {
      const sb = getAdminSupabase();
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const id = String(body?.id || "").trim();
      if (id) await sb.from("renders").update({ caption_status: "failed", caption_error: String(e?.message || e) }).eq("id", id);
    } catch {}

    return res.status(200).json({ ok: true }); // don't spam retries
  }
};
