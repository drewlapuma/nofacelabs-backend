// api/captions-start.js (CommonJS, Node 18)

const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

function pickTemplate(body) {
  return String(
    body?.templateId ||
      body?.template_id ||
      body?.templateName ||
      body?.template_name ||
      body?.template ||
      body?.style ||
      body?.preset ||
      ""
  ).trim();
}

async function smCreateProject({ templateName, videoUrl, title, language = "en" }) {
  // You previously had 2 different header styles in your code.
  // This one matches your submagic-templates.js: Bearer token.
  const r = await fetch(`${SUBMAGIC_BASE}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUBMAGIC_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      language,
      videoUrl,
      templateName, // Submagic template name string
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_CREATE_FAILED (${r.status})`);
  return j; // expect { id, status, ... }
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

    const templateName = pickTemplate(body);

    const { data: row, error } = await sb
      .from("renders")
      .select("id, member_id, video_url, choices, caption_status, submagic_proj, captioned_vide")
      .eq("id", id)
      .eq("member_id", member_id)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // If already completed
    if (row.captioned_vide) {
      return res.status(200).json({ ok: true, already: true, status: "completed", captioned: row.captioned_vide });
    }

    // If already started, don't create a new one
    if (row.submagic_proj) {
      return res.status(200).json({ ok: true, already: true, projectId: row.submagic_proj, status: row.caption_status || "captioning" });
    }

    // Mark started immediately (prevents double clicks)
    await sb.from("renders").update({
      caption_status: "captioning",
      caption_error: null,
      caption_templ: templateName || null,
    }).eq("id", row.id);

    const title = row?.choices?.storyType || row?.choices?.customPrompt || "NofaceLabs Video";
    const created = await smCreateProject({
      templateName: templateName || undefined,
      videoUrl: row.video_url,
      title,
      language: "en",
    });

    const projectId = created?.id || created?.projectId || created?.project_id;
    if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

    await sb.from("renders").update({
      submagic_proj: String(projectId),
      caption_status: String(created?.status || "captioning"),
      caption_error: null,
    }).eq("id", row.id);

    // ✅ Return immediately (NO waiting/polling here)
    return res.status(200).json({ ok: true, already: false, projectId: String(projectId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
