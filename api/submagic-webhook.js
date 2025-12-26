// api/submagic-webhook.js (CommonJS)
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

async function smGetProject(projectId) {
  const r = await fetch(`${SUBMAGIC_BASE}/projects/${encodeURIComponent(projectId)}`, {
    headers: { Authorization: `Bearer ${SUBMAGIC_API_KEY}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_${r.status}`);
  return j;
}

module.exports = async function handler(req, res) {
  // Submagic will POST. Allow OPTIONS.
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    // Body may arrive as string
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // Try to find project id in common places
    const projectId =
      body?.projectId ||
      body?.project_id ||
      body?.id ||
      body?.data?.projectId ||
      body?.data?.project_id ||
      body?.data?.id ||
      "";

    if (!projectId) return res.status(400).json({ ok: false, error: "MISSING_PROJECT_ID" });

    const sb = getAdminSupabase();

    // Find render row by submagic_project_id
    const { data: row, error: findErr } = await sb
      .from("renders")
      .select("*")
      .eq("submagic_project_id", String(projectId))
      .single();

    if (findErr || !row) {
      // Return 200 so Submagic doesn't retry forever
      return res.status(200).json({ ok: true, ignored: true, reason: "NO_MATCHING_RENDER" });
    }

    const proj = await smGetProject(projectId);

    // Prefer downloadUrl/directUrl once export is done
    const downloadUrl = proj?.downloadUrl || proj?.directUrl || "";

    if (downloadUrl) {
      await sb.from("renders").update({
        caption_status: "completed",
        captioned_video_url: String(downloadUrl),
        caption_error: null,
      }).eq("id", row.id);
    } else {
      await sb.from("renders").update({
        caption_status: String(proj?.status || "captioning"),
      }).eq("id", row.id);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Don't spam retries
    return res.status(200).json({ ok: true, error: String(e?.message || e) });
  }
};
