// api/renders.js (CommonJS) — COMBINED
// GET  /api/renders             => list
// GET  /api/renders?id=<uuid>   => single
// POST /api/renders             => actions (captions-start)

const { requireMemberId } = require("./_lib/auth");
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

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

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

// Detect which column names exist on THIS database row (tolerant to schema drift)
function resolveCols(row) {
  const has = (k) => row && Object.prototype.hasOwnProperty.call(row, k);

  return {
    submagicProject: has("submagic_project_id") ? "submagic_project_id" : (has("submagic_proj") ? "submagic_proj" : "submagic_project_id"),
    captionedUrl: has("captioned_video_url") ? "captioned_video_url" : (has("captioned_vide") ? "captioned_vide" : "captioned_video_url"),
    captionTemplate: has("caption_template_id") ? "caption_template_id" : (has("caption_templ") ? "caption_templ" : "caption_template_id"),
    captionStatus: has("caption_status") ? "caption_status" : "caption_status",
    captionError: has("caption_error") ? "caption_error" : "caption_error",
  };
}

// Normalize row -> stable API response keys (what your Webflow expects)
function normalizeRow(row) {
  const cols = resolveCols(row);

  return {
    id: row.id,
    created_at: row.created_at,
    status: row.status,
    video_url: row.video_url,
    render_id: row.render_id,
    choices: row.choices,
    error: row.error,

    caption_status: row[cols.captionStatus] ?? null,
    caption_error: row[cols.captionError] ?? null,
    submagic_project_id: row[cols.submagicProject] ?? null,      // always return this key to the UI
    captioned_video_url: row[cols.captionedUrl] ?? null,         // always return this key to the UI
    caption_template_id: row[cols.captionTemplate] ?? null,      // always return this key to the UI
  };
}

async function smCreateProject({ templateName, videoUrl, title, language = "en" }) {
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
      templateName,
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_CREATE_FAILED (${r.status})`);
  return j;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  // ---------------- GET (list / single) ----------------
  if (req.method === "GET") {
    try {
      const member_id = await requireMemberId(req);
      const sb = getAdminSupabase();

      const id = String(req.query?.id || "").trim();

      if (id) {
        const { data, error } = await sb
          .from("renders")
          .select("*")                 // ✅ prevents “column does not exist” failures
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        return res.status(200).json({ ok: true, item: normalizeRow(data) });
      }

      const { data, error } = await sb
        .from("renders")
        .select("*")                   // ✅ prevents “column does not exist” failures
        .eq("member_id", member_id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED" });

      return res.status(200).json({ ok: true, items: (data || []).map(normalizeRow) });
    } catch (err) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: String(err?.message || err) });
    }
  }

  // ---------------- POST (actions) ----------------
  if (req.method === "POST") {
    try {
      const member_id = await requireMemberId(req);
      const sb = getAdminSupabase();

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const action = String(body?.action || "").trim();

      if (action !== "captions-start") {
        return res.status(400).json({ ok: false, error: "BAD_ACTION" });
      }

      if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

      const id = String(body?.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

      const templateName = pickTemplate(body);

      const { data: row, error } = await sb
        .from("renders")
        .select("*") // ✅ tolerant
        .eq("id", id)
        .eq("member_id", member_id)
        .single();

      if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

      const cols = resolveCols(row);

      // Already captioned
      if (row[cols.captionedUrl]) {
        return res.status(200).json({
          ok: true,
          already: true,
          status: "completed",
          captioned_video_url: row[cols.captionedUrl],
        });
      }

      // Already started
      if (row[cols.submagicProject]) {
        return res.status(200).json({
          ok: true,
          already: true,
          projectId: row[cols.submagicProject],
          status: row[cols.captionStatus] || "captioning",
        });
      }

      // Mark started (schema-tolerant update)
      const startUpdate = {
        [cols.captionStatus]: "captioning",
        [cols.captionError]: null,
        [cols.captionTemplate]: templateName || null,
      };

      await sb.from("renders").update(startUpdate).eq("id", row.id);

      const title = row?.choices?.storyType || row?.choices?.customPrompt || "NofaceLabs Video";

      const created = await smCreateProject({
        templateName: templateName || undefined,
        videoUrl: row.video_url,
        title,
        language: "en",
      });

      const projectId = created?.id || created?.projectId || created?.project_id;
      if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

      const finishUpdate = {
        [cols.submagicProject]: String(projectId),
        [cols.captionStatus]: String(created?.status || "captioning"),
        [cols.captionError]: null,
      };

      await sb.from("renders").update(finishUpdate).eq("id", row.id);

      return res.status(200).json({ ok: true, already: false, projectId: String(projectId) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
    }
  }

  return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
};
