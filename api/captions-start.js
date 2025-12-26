// api/captions-start.js (CommonJS, Node 18)

const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

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
  // Keep auth style consistent with your templates endpoint (Bearer)
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
      templateName: templateName || undefined,
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_CREATE_FAILED (${r.status})`);
  return j;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

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
      .select("id, member_id, video_url, choices, caption_status, captioned_video_url, submagic_project_id")
      .eq("id", id)
      .eq("member_id", member_id)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // already done
    if (row.captioned_video_url) {
      return res.status(200).json({ ok: true, already: true, status: "completed", captioned: row.captioned_video_url });
    }

    // already started
    if (row.submagic_project_id) {
      return res.status(200).json({
        ok: true,
        already: true,
        projectId: row.submagic_project_id,
        status: row.caption_status || "captioning",
      });
    }

    // mark started first (prevents double-click dupes)
    await sb
      .from("renders")
      .update({
        caption_status: "captioning",
        caption_error: null,
        caption_template: templateName || null,
      })
      .eq("id", row.id);

    const title = row?.choices?.storyType || row?.choices?.customPrompt || "NofaceLabs Video";

    const created = await smCreateProject({
      templateName,
      videoUrl: row.video_url,
      title,
      language: "en",
    });

    const projectId = created?.id || created?.projectId || created?.project_id;
    if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

    await sb
      .from("renders")
      .update({
        submagic_project_id: String(projectId),
        caption_status: String(created?.status || "captioning"),
        caption_error: null,
      })
      .eq("id", row.id);

    return res.status(200).json({ ok: true, already: false, projectId: String(projectId) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
