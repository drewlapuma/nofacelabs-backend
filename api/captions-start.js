// api/captions-start.js (CommonJS)
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = process.env.SUBMAGIC_API_KEY; // sk-...
const API_BASE = (process.env.API_BASE || "").trim();  // https://nofacelabs-backend.vercel.app
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

async function smFetch(path, opts = {}) {
  const r = await fetch(`${SUBMAGIC_BASE}${path}`, {
    ...opts,
    headers: {
      "x-api-key": SUBMAGIC_API_KEY,
      ...(opts.headers || {}),
    },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_${r.status}`);
  return j;
}

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
    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    const { data: row, error } = await sb
      .from("renders")
      .select("id, member_id, status, video_url, caption_status, submagic_project_id, choices")
      .eq("id", id)
      .eq("member_id", member_id)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // prevent double-start
    if (row.caption_status && String(row.caption_status).toLowerCase().includes("caption"))
      return res.status(200).json({ ok: true, already: true, projectId: row.submagic_project_id || null });

    // 1) (Recommended) create project using a Submagic template
    // You’ll pick a template ID/name from GET /v1/templates (Submagic “Get Templates”).
    // For now, assume you saved it in env:
    const TEMPLATE_ID = process.env.SUBMAGIC_TEMPLATE_ID; // set this after you pick one
    if (!TEMPLATE_ID) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_TEMPLATE_ID" });

    const title = row?.choices?.storyType || "NofaceLabs Video";
    const language = "en"; // map from your choices.language

    // Create project (Submagic)
    const created = await smFetch(`/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        language,
        templateId: TEMPLATE_ID,
      }),
    });

    const projectId = created?.id || created?.projectId;
    if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

    // 2) Upload project’s video (Submagic has “Upload Project” endpoint)
    // Many APIs support either a URL import or multipart upload; Submagic docs show an Upload Project endpoint.
    // If the upload endpoint expects multipart, you’ll need FormData.
    const fd = new FormData();
    fd.append("videoUrl", row.video_url); // if Submagic supports URL ingest
    await smFetch(`/projects/${encodeURIComponent(projectId)}/upload`, {
      method: "POST",
      body: fd,
    });

    // 3) Export (render final captioned video) with webhookUrl
    await smFetch(`/projects/${encodeURIComponent(projectId)}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl: `${API_BASE}/api/submagic-webhook?id=${encodeURIComponent(row.id)}`,
      }),
    });

    await sb.from("renders").update({
      caption_status: "captioning",
      submagic_project_id: projectId,
      caption_error: null,
    }).eq("id", row.id);

    return res.status(200).json({ ok: true, projectId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
