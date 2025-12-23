// api/submagic-webhook.js
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = process.env.SUBMAGIC_API_KEY;
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

async function smGetProject(projectId) {
  const r = await fetch(`${SUBMAGIC_BASE}/projects/${encodeURIComponent(projectId)}`, {
    headers: { "x-api-key": SUBMAGIC_API_KEY },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || `SUBMAGIC_${r.status}`);
  return j;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const dbId = req.query?.id;
    if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_DB_ID" });

    const sb = getAdminSupabase();

    const { data: row } = await sb
      .from("renders")
      .select("id, submagic_project_id")
      .eq("id", dbId)
      .single();

    if (!row?.submagic_project_id) return res.status(400).json({ ok: false, error: "NO_SUBMAGIC_PROJECT" });

    const proj = await smGetProject(row.submagic_project_id);

    // Submagic says downloadUrl/directUrl appear after export completes. :contentReference[oaicite:3]{index=3}
    const downloadUrl = proj?.downloadUrl || proj?.directUrl || "";

    if (downloadUrl) {
      await sb.from("renders").update({
        caption_status: "completed",
        captioned_video_url: downloadUrl,
        caption_error: null,
      }).eq("id", dbId);
    } else {
      await sb.from("renders").update({
        caption_status: String(proj?.status || "captioning"),
      }).eq("id", dbId);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    try {
      const sb = getAdminSupabase();
      const dbId = req.query?.id;
      if (dbId) {
        await sb.from("renders").update({
          caption_status: "failed",
          caption_error: String(e?.message || e),
        }).eq("id", dbId);
      }
    } catch {}
    return res.status(200).json({ ok: true }); // don’t spam retries
  }
};
