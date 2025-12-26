// api/submagic-webhook.js (CommonJS, Node 18)

const { getAdminSupabase } = require("./_lib/supabase");

const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
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

async function smGetProject(projectId) {
  const r = await fetch(`${SUBMAGIC_BASE}/projects/${encodeURIComponent(projectId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${SUBMAGIC_API_KEY}`,
      "Content-Type": "application/json",
    },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_GET_FAILED (${r.status})`);
  return j;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_DB_ID" });

  const sb = getAdminSupabase();

  try {
    if (!SUBMAGIC_API_KEY) {
      return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });
    }

    // Pull the render row
    const { data: row, error } = await sb
      .from("renders")
      .select("id, submagic_project_id, caption_status, caption_error, captioned_video_url")
      .eq("id", dbId)
      .single();

    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.submagic_project_id) return res.status(400).json({ ok: false, error: "NO_SUBMAGIC_PROJECT" });

    const proj = await smGetProject(row.submagic_project_id);

    // Submagic commonly returns one of these when export finishes
    const downloadUrl = proj?.downloadUrl || proj?.directUrl || proj?.url || "";

    if (downloadUrl) {
      await sb
        .from("renders")
        .update({
          caption_status: "completed",
          captioned_video_url: String(downloadUrl),
          caption_error: null,
        })
        .eq("id", dbId);

      return res.status(200).json({ ok: true, status: "completed" });
    }

    // Not ready yet → update status only
    await sb
      .from("renders")
      .update({
        caption_status: String(proj?.status || "captioning"),
        caption_error: null,
      })
      .eq("id", dbId);

    return res.status(200).json({ ok: true, status: String(proj?.status || "captioning") });
  } catch (e) {
    // Try to write failure state, but still return 200 to avoid webhook retry spam
    try {
      await sb
        .from("renders")
        .update({
          caption_status: "failed",
          caption_error: String(e?.message || e),
        })
        .eq("id", dbId);
    } catch {}

    return res.status(200).json({ ok: true });
  }
};
