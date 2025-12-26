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

function pickProjectId(body) {
  // Different webhook payloads put the id in different places.
  return String(
    body?.projectId ||
      body?.project_id ||
      body?.id ||
      body?.data?.projectId ||
      body?.data?.project_id ||
      body?.data?.id ||
      ""
  ).trim();
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const sb = getAdminSupabase();

  try {
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const projectId = pickProjectId(body);

    if (!projectId) return res.status(400).json({ ok: false, error: "MISSING_PROJECT_ID" });

    // Find render by submagic project id
    const { data: row } = await sb
      .from("renders")
      .select("id, submagic_project_id")
      .eq("submagic_project_id", projectId)
      .single();

    if (!row?.id) {
      // Return 200 so Submagic doesn't retry forever
      return res.status(200).json({ ok: true, ignored: true, reason: "NO_MATCHING_RENDER" });
    }

    const proj = await smGetProject(projectId);

    const downloadUrl = String(proj?.downloadUrl || proj?.directUrl || "").trim();
    const status = String(proj?.status || "captioning").trim();

    if (downloadUrl) {
      await sb.from("renders").update({
        caption_status: "completed",
        captioned_video_url: downloadUrl,
        caption_error: null,
      }).eq("id", row.id);
    } else {
      await sb.from("renders").update({
        caption_status: status || "captioning",
      }).eq("id", row.id);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Do NOT cause retries. Log error into the row if we can.
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const projectId = pickProjectId(body);

      if (projectId) {
        const { data: row } = await sb
          .from("renders")
          .select("id")
          .eq("submagic_project_id", projectId)
          .single();

        if (row?.id) {
          await sb.from("renders").update({
            caption_status: "failed",
            caption_error: String(e?.message || e),
          }).eq("id", row.id);
        }
      }
    } catch (_) {}

    return res.status(200).json({ ok: true });
  }
};
