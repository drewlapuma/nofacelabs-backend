// api/renders.js
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

async function smCreateProject({ templateName, videoUrl, title, language = "en" }) {
  if (!SUBMAGIC_API_KEY) throw new Error("MISSING_SUBMAGIC_API_KEY");

  // NOTE: Submagic auth varies by account; your webhook uses x-api-key.
  // If your create endpoint requires x-api-key too, swap to that.
  const r = await fetch(`${SUBMAGIC_BASE}/projects`, {
    method: "POST",
    headers: {
      "x-api-key": SUBMAGIC_API_KEY,            // ✅ matches your webhook style
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
  // ✅ CORS MUST BE FIRST
  try {
    setCors(req, res);

    // ✅ Preflight must succeed
    if (req.method === "OPTIONS") return res.status(204).end();

    const sb = getAdminSupabase();

    // ---------------- GET ----------------
    if (req.method === "GET") {
      try {
        const member_id = await requireMemberId(req);
        const id = String(req.query?.id || "").trim();

        if (id) {
          const { data, error } = await sb
            .from("renders")
            .select("*")
            .eq("id", id)
            .eq("member_id", member_id)
            .single();

          if (error || !data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
          return res.status(200).json({ ok: true, item: data });
        }

        const { data, error } = await sb
          .from("renders")
          .select("*")
          .eq("member_id", member_id)
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED" });
        return res.status(200).json({ ok: true, items: data || [] });
      } catch (e) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: String(e?.message || e) });
      }
    }

    // ---------------- POST (captions-start) ----------------
    if (req.method === "POST") {
      try {
        const member_id = await requireMemberId(req);

        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const action = String(body?.action || "").trim();
        if (action !== "captions-start") return res.status(400).json({ ok: false, error: "BAD_ACTION" });

        const id = String(body?.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

        const templateName = pickTemplate(body);

        const { data: row, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

        // already created
        if (row.submagic_project_id) {
          return res.status(200).json({
            ok: true,
            already: true,
            projectId: row.submagic_project_id,
            status: row.caption_status || "captioning",
          });
        }

        // mark started
        await sb.from("renders").update({
          caption_status: "captioning",
          caption_error: null,
          caption_template_id: templateName || null,
        }).eq("id", row.id);

        const title = row?.choices?.storyType || row?.choices?.customPrompt || "NofaceLabs Video";

        const created = await smCreateProject({
          templateName,
          videoUrl: row.video_url,
          title,
          language: "en",
        });

        const projectId = created?.id || created?.projectId || created?.project_id;
        if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

        await sb.from("renders").update({
          submagic_project_id: String(projectId),
          caption_status: String(created?.status || "captioning"),
          caption_error: null,
        }).eq("id", row.id);

        return res.status(200).json({ ok: true, already: false, projectId: String(projectId) });
      } catch (e) {
        return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
      }
    }

    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (fatal) {
    // ✅ even fatal errors should still have CORS headers (setCors ran)
    return res.status(500).json({ ok: false, error: "FATAL", message: String(fatal?.message || fatal) });
  }
};
