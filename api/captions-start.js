// api/captions-start.js (CommonJS)
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");
const { submagicCreateProject } = require("./_lib/submagic");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const API_BASE = (process.env.API_BASE || "").trim();

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });
    if (!API_BASE) return res.status(500).json({ ok: false, error: "MISSING_API_BASE" });

    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id = body?.id;
    const templateName = String(body?.templateName || "").trim();

    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });
    if (!templateName) return res.status(400).json({ ok: false, error: "MISSING_TEMPLATE_NAME" });

    const { data: row, error } = await sb
      .from("renders")
      .select("id, member_id, status, video_url, caption_status, submagic_project_id, choices")
      .eq("id", id)
      .eq("member_id", member_id)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // Prevent re-start if already started
    if (row.submagic_project_id || (row.caption_status && String(row.caption_status).toLowerCase().includes("caption"))) {
      return res.status(200).json({ ok: true, already: true, projectId: row.submagic_project_id || null });
    }

    // mark captioning first to avoid double-click duplicates
    await sb.from("renders").update({
      caption_status: "captioning",
      caption_error: null,
    }).eq("id", row.id);

    const title =
      row?.choices?.storyType ||
      row?.choices?.customPrompt ||
      "NofaceLabs Video";

    // ✅ Create Submagic project (your helper already supports templateName + webhookUrl)
    const created = await submagicCreateProject({
      apiKey: SUBMAGIC_API_KEY,
      videoUrl: row.video_url,
      title,
      language: "en", // TODO: map from row.choices.language if you want
      templateName,
      webhookUrl: `${API_BASE}/api/submagic-webhook?id=${encodeURIComponent(row.id)}`,
    });

    await sb.from("renders").update({
      submagic_project_id: created?.id || null,
      caption_status: String(created?.status || "captioning"),
      caption_error: null,
    }).eq("id", row.id);

    return res.status(200).json({ ok: true, projectId: created?.id || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
