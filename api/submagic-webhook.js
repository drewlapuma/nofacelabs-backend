// api/submagic-webhook.js
const { getAdminSupabase } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const sb = getAdminSupabase();
    const raw = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const body = Array.isArray(raw) ? raw[0] : raw;

    const projectId = body?.projectId || body?.id;
    const status = String(body?.status || "").toLowerCase();

    const downloadUrl = body?.downloadUrl || body?.directUrl || body?.url || null;
    const errorMsg = body?.error || body?.message || null;

    if (!projectId) return res.status(400).json({ ok: false, error: "MISSING_PROJECT_ID" });

    const update = {
      caption_status: status || "updated",
    };

    if (downloadUrl) {
      update.caption_status = "succeeded";
      update.captioned_video_url = downloadUrl;
      update.caption_error = null;
    } else if (status.includes("fail") || status.includes("error")) {
      update.caption_status = "failed";
      update.caption_error = String(errorMsg || "Caption export failed.");
    }

    await sb.from("renders").update(update).eq("submagic_project_id", String(projectId));
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(err?.message || err) });
  }
};
