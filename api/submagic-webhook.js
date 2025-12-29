// api/submagic-webhook.js (CommonJS)
// Receives Submagic webhook calls and updates your "renders" row.
// Supports both query params: ?id=... (legacy) and ?db_id=... (newer).
//
// ✅ Always returns 200 so Submagic doesn't retry forever.
// ✅ Updates caption_status + captioned_video_url when download url is ready.

const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

async function smGetProject(projectId) {
  if (!SUBMAGIC_API_KEY) throw new Error("MISSING_SUBMAGIC_API_KEY");

  const r = await fetch(`${SUBMAGIC_BASE}/projects/${encodeURIComponent(projectId)}`, {
    headers: { "x-api-key": SUBMAGIC_API_KEY },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_${r.status}`);
  return j;
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "captioning";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "completed";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("caption")) return "captioning";
  return x;
}

function extractDownloadUrl(proj) {
  return (
    proj?.downloadUrl ||
    proj?.directUrl ||
    proj?.export?.downloadUrl ||
    proj?.export?.directUrl ||
    proj?.exports?.[0]?.downloadUrl ||
    proj?.exports?.[0]?.directUrl ||
    ""
  );
}

module.exports = async function handler(req, res) {
  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  // Submagic should POST webhooks, but we return 200 anyway to avoid retries
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const dbId =
    String(req.query?.db_id || req.query?.id || "").trim(); // ✅ supports both

  if (!dbId) return res.status(200).json({ ok: true });

  const sb = getAdminSupabase();

  try {
    const { data: row, error } = await sb
      .from("renders")
      .select("id, submagic_project_id, captioned_video_url")
      .eq("id", dbId)
      .single();

    if (error || !row?.submagic_project_id) {
      // still return 200 to prevent retries
      return res.status(200).json({ ok: true });
    }

    // If already captioned, do nothing (idempotent)
    if (row.captioned_video_url) return res.status(200).json({ ok: true });

    const proj = await smGetProject(row.submagic_project_id);

    const downloadUrl = extractDownloadUrl(proj);
    const status = normStatus(proj?.status);

    if (downloadUrl) {
      await sb
        .from("renders")
        .update({
          caption_status: "completed",
          captioned_video_url: String(downloadUrl),
          caption_error: null,
        })
        .eq("id", dbId);
    } else {
      await sb
        .from("renders")
        .update({
          caption_status: status,
        })
        .eq("id", dbId);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Mark failed so your UI stops spinning
    try {
      await sb
        .from("renders")
        .update({
          caption_status: "failed",
          caption_error: String(e?.message || e),
        })
        .eq("id", dbId);
    } catch {
      // ignore
    }

    // ✅ Always 200 so Submagic doesn't retry forever
    return res.status(200).json({ ok: true });
  }
};
