// api/renders.js (CommonJS, Node 18) — COMBINED
// GET  /api/renders                => list
// GET  /api/renders?id=<uuid>      => single
// POST /api/renders {action:"captions_start", id, templateName} => start captions

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
    body?.templateName ||
      body?.templateId ||
      body?.template ||
      body?.style ||
      body?.preset ||
      ""
  ).trim();
}

async function smCreateProject({ templateName, videoUrl, title, language = "en" }) {
  if (!SUBMAGIC_API_KEY) throw new Error("MISSING_SUBMAGIC_API_KEY");

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
  if (!r.ok) {
    const msg = j?.message || j?.error || `SUBMAGIC_CREATE_FAILED (${r.status})`;
    const err = new Error(msg);
    err.details = j;
    err.status = r.status;
    throw err;
  }

  return j;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    // =========================
    // POST: captions_start
    // =========================
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const action = String(body?.action || "").trim();

      if (action !== "captions_start") {
        return res.status(400).json({ ok: false, error: "BAD_ACTION" });
      }

      const id = String(body?.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

      const templateName = pickTemplate(body);

      const { data: row, error } = await sb
        .from("renders")
        .select([
          "id",
          "member_id",
          "video_url",
          "choices",
          "caption_status",
          "caption_error",
          "caption_template_id",
          "captioned_video_url",
          "submagic_project_id",
        ].join(", "))
        .eq("id", id)
        .single();

      if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

      if (String(row.member_id) !== String(member_id)) {
        return res.status(403).json({ ok: false, error: "FORBIDDEN_MEMBER_MISMATCH" });
      }

      if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

      // already done
      if (row.captioned_video_url) {
        return res.status(200).json({
          ok: true,
          already: true,
          status: "completed",
          captioned: row.captioned_video_url,
        });
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

      // mark started first
      await sb
        .from("renders")
        .update({
          caption_status: "captioning",
          caption_error: null,
          caption_template_id: templateName || null,
        })
        .eq("id", row.id);

      const title =
        row?.choices?.storyType ||
        row?.choices?.customPrompt ||
        "NofaceLabs Video";

      const created = await smCreateProject({
        templateName: templateName || undefined,
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

      return res.status(200).json({
        ok: true,
        already: false,
        projectId: String(projectId),
        status: String(created?.status || "captioning"),
      });
    }

    // =========================
    // GET: list or single
    // =========================
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const id = String(req.query?.id || "").trim();

    // single
    if (id) {
      const { data, error: dbErr } = await sb
        .from("renders")
        .select([
          "id",
          "created_at",
          "status",
          "video_url",
          "render_id",
          "choices",
          "error",
          "caption_status",
          "caption_error",
          "submagic_project_id",
          "captioned_video_url",
          "caption_template_id",
        ].join(", "))
        .eq("id", id)
        .eq("member_id", member_id)
        .single();

      if (dbErr || !data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
      return res.status(200).json({ ok: true, item: data });
    }

    // list
    const { data, error } = await sb
      .from("renders")
      .select([
        "id",
        "created_at",
        "status",
        "video_url",
        "render_id",
        "choices",
        "error",
        "caption_status",
        "caption_error",
        "submagic_project_id",
        "captioned_video_url",
        "caption_template_id",
      ].join(", "))
      .eq("member_id", member_id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED" });
    return res.status(200).json({ ok: true, items: data || [] });

  } catch (err) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: String(err?.message || err) });
  }
};
