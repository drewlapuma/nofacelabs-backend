// api/captions-start.js
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = process.env.SUBMAGIC_API_KEY; // store your sk- key in Vercel env
const SUBMAGIC_BASE = "https://api.submagic.co";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const renderId = body?.id;
    if (!renderId) return res.status(400).json({ ok: false, error: "MISSING_RENDER_ID" });

    // Load render row
    const { data: render, error: rErr } = await sb
      .from("renders")
      .select("id, member_id, video_url, choices")
      .eq("id", renderId)
      .eq("member_id", member_id)
      .single();

    if (rErr || !render) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!render.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // Build Submagic Create Project request (uses videoUrl + templateName + webhookUrl)
    // templateName: you can fetch valid templates via Submagic "Get Templates" later.
    const templateName = body?.templateName || "Default";
    const language = body?.language || render?.choices?.language || "English";

    const publicBaseUrl = process.env.API_BASE || `https://${req.headers.host}`;
    const webhookUrl = `${publicBaseUrl}/api/submagic-webhook`;

    const createResp = await fetch(`${SUBMAGIC_BASE}/v1/projects`, {
      method: "POST",
      headers: {
        "x-api-key": SUBMAGIC_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: `Captions - ${render.id}`,
        language,
        videoUrl: render.video_url,
        templateName,
        webhookUrl,
      }),
    });

    const created = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      return res.status(502).json({ ok: false, error: "SUBMAGIC_CREATE_FAILED", details: created });
    }

    const projectId = created?.projectId || created?.id;
    if (!projectId) return res.status(502).json({ ok: false, error: "SUBMAGIC_NO_PROJECT_ID", details: created });

    // Trigger export/render (asynchronous)
    const exportResp = await fetch(`${SUBMAGIC_BASE}/v1/projects/${encodeURIComponent(projectId)}/export`, {
      method: "POST",
      headers: {
        "x-api-key": SUBMAGIC_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        webhookUrl, // Submagic supports webhookUrl on export too
      }),
    });

    const exported = await exportResp.json().catch(() => ({}));
    if (!exportResp.ok) {
      return res.status(502).json({ ok: false, error: "SUBMAGIC_EXPORT_FAILED", details: exported });
    }

    // Save caption job info
    await sb.from("renders").update({
      submagic_project_id: projectId,
      caption_status: "exporting",
      caption_error: null,
      captioned_video_url: null,
    }).eq("id", render.id);

    return res.status(200).json({ ok: true, projectId, status: "exporting" });

  } catch (err) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(err?.message || err) });
  }
};
