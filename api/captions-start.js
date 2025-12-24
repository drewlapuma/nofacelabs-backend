// api/captions-start.js (CommonJS, Node 18)
// Starts Submagic captions for a render row, using a template chosen by the user (or env fallback).
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const API_BASE = (process.env.API_BASE || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

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
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });
    if (!API_BASE) return res.status(500).json({ ok: false, error: "MISSING_API_BASE" });

    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const id = String(body?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    const { data: row, error } = await sb
      .from("renders")
      .select("id, member_id, status, video_url, caption_status, submagic_project_id, choices")
      .eq("id", id)
      .eq("member_id", member_id)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    const capStatus = String(row.caption_status || "").toLowerCase();
    if (row.submagic_project_id || capStatus.includes("caption")) {
      return res.status(200).json({ ok: true, already: true, projectId: row.submagic_project_id || null });
    }

    // ✅ template: allow from client OR fallback to env
    const templateFromBody = String(body?.templateId || body?.templateName || "").trim();
    const TEMPLATE_ID = templateFromBody || String(process.env.SUBMAGIC_TEMPLATE_ID || "").trim();
    if (!TEMPLATE_ID) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_TEMPLATE_ID" });

    const choices = row.choices || {};
    const title = choices.storyType || choices.customPrompt || "NofaceLabs Video";

    // Map language if you want (default en)
    const language = String(choices.language || "en").toLowerCase().startsWith("en") ? "en" : "en";

    // 1) Create project
    const created = await smFetch(`/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        language,
        templateId: TEMPLATE_ID, // ✅ uses chosen template
      }),
    });

    const projectId = created?.id || created?.projectId;
    if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

    // 2) Upload video (URL ingest)
    const fd = new FormData();
    fd.append("videoUrl", row.video_url);

    await smFetch(`/projects/${encodeURIComponent(projectId)}/upload`, {
      method: "POST",
      body: fd,
    });

    // 3) Export with webhook back to your API
    await smFetch(`/projects/${encodeURIComponent(projectId)}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookUrl: `${API_BASE}/api/submagic-webhook?id=${encodeURIComponent(row.id)}`,
      }),
    });

    // ✅ persist status + chosen template
    await sb
      .from("renders")
      .update({
        caption_status: "captioning",
        submagic_project_id: projectId,
        caption_error: null,
        // optional: store what they picked
        caption_template_id: TEMPLATE_ID,
      })
      .eq("id", row.id);

    return res.status(200).json({ ok: true, projectId, templateId: TEMPLATE_ID });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
