// api/captions-start.js (CommonJS, Node 18)

const { createClient } = require("@supabase/supabase-js");
const memberstackAdmin = require("@memberstack/admin");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

const SUBMAGIC_API_KEY = process.env.SUBMAGIC_API_KEY;
const SUBMAGIC_BASE = process.env.SUBMAGIC_BASE || "https://api.submagic.co"; // adjust if yours differs
const SUBMAGIC_DEFAULT_TEMPLATE = (process.env.SUBMAGIC_DEFAULT_TEMPLATE || "").trim();

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) throw new Error("MISSING_AUTH");
  if (!ms) throw new Error("MISSING_MEMBERSTACK_SECRET_KEY");
  const { id } = await ms.verifyToken({ token });
  if (!id) throw new Error("INVALID_MEMBER_TOKEN");
  return id;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!supabase) return res.status(500).json({ ok: false, error: "MISSING_SUPABASE_ENV_VARS" });
    if (!SUBMAGIC_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_SUBMAGIC_API_KEY" });

    const memberId = await requireMemberId(req);

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const dbId = String(body.id || "").trim();
    if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    // accept MANY key names
    const chosen =
      String(
        body.templateId ||
          body.template_id ||
          body.templateName ||
          body.template_name ||
          body.template ||
          body.style ||
          body.preset ||
          ""
      ).trim();

    const templateToUse = chosen || SUBMAGIC_DEFAULT_TEMPLATE || "";

    // Load render + verify ownership
    const { data: render, error: rErr } = await supabase
      .from("renders")
      .select("id, member_id, video_url, caption_status, caption_project_id, captioned_video_url")
      .eq("id", dbId)
      .single();

    if (rErr || !render) return res.status(404).json({ ok: false, error: "RENDER_NOT_FOUND" });
    if (String(render.member_id) !== String(memberId)) return res.status(403).json({ ok: false, error: "FORBIDDEN" });
    if (!render.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // If already done, return immediately
    if (render.captioned_video_url) {
      return res.status(200).json({
        ok: true,
        already: true,
        status: "completed",
        captioned_video_url: render.captioned_video_url,
      });
    }

    // If already captioning, return immediately (DO NOT POLL HERE)
    const currentStatus = String(render.caption_status || "").toLowerCase();
    if (currentStatus === "captioning" && render.caption_project_id) {
      return res.status(200).json({
        ok: true,
        already: true,
        status: "captioning",
        projectId: render.caption_project_id,
      });
    }

    // Create / start Submagic project (FAST)
    // NOTE: replace this endpoint/payload with your actual Submagic call
    const startResp = await fetch(`${SUBMAGIC_BASE}/projects`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUBMAGIC_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        video_url: render.video_url,
        template: templateToUse || undefined,
        template_name: templateToUse || undefined,
      }),
    });

    const startJson = await startResp.json().catch(() => ({}));
    if (!startResp.ok) {
      await supabase
        .from("renders")
        .update({ caption_status: "failed", caption_error: JSON.stringify(startJson) })
        .eq("id", dbId);

      return res.status(502).json({ ok: false, error: "SUBMAGIC_START_FAILED", details: startJson });
    }

    const projectId = startJson.projectId || startJson.id || startJson.project_id || null;

    // Save captioning state and return immediately
    await supabase
      .from("renders")
      .update({
        caption_status: "captioning",
        caption_project_id: projectId,
        caption_template: templateToUse || null,
        caption_error: null,
      })
      .eq("id", dbId);

    return res.status(200).json({
      ok: true,
      already: false,
      status: "captioning",
      projectId,
      template: templateToUse || null,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = msg.includes("MISSING_AUTH") || msg.includes("INVALID_MEMBER") ? 401 : 500;
    return res.status(code).json({ ok: false, error: code === 401 ? "UNAUTHORIZED" : "SERVER_ERROR", message: msg });
  }
};
