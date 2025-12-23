// api/creatomate-webhook.js
const { getAdminSupabase } = require("./_lib/supabase");

// ---------------- Submagic helper (inline) ----------------
async function submagicCreateProject({ apiKey, videoUrl, title, language = "en", templateName }) {
  // NOTE: endpoint/shape may vary depending on Submagic's docs.
  // If their docs show a different URL or header name, swap it here.
  const r = await fetch("https://api.submagic.co/v1/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
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
  if (!j?.id) throw new Error("SUBMAGIC_MISSING_PROJECT_ID");
  return j; // { id, status, ... }
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const sb = getAdminSupabase();

    const raw = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const body = Array.isArray(raw) ? raw[0] : raw;

    const render_id = String(body?.id || body?.render_id || "");
    const statusRaw = String(body?.status || "").toLowerCase();

    // Creatomate output can appear in multiple shapes
    const video_url =
      body?.output ||
      body?.video_url ||
      body?.url ||
      (Array.isArray(body?.outputs) ? (body.outputs[0]?.url || body.outputs[0]?.output) : null) ||
      null;

    if (!render_id) return res.status(400).json({ error: "MISSING_RENDER_ID" });

    // 1) Update the render row from Creatomate webhook
    const update = {};
    if (statusRaw) update.status = statusRaw; // e.g. "succeeded"
    if (video_url) update.video_url = video_url;

    const { error: updErr } = await sb.from("renders").update(update).eq("render_id", render_id);
    if (updErr) {
      console.error("[WEBHOOK] supabase update error", updErr);
      return res.status(500).json({ error: "SUPABASE_UPDATE_FAILED" });
    }

    // 2) If succeeded + video_url => kick off captions (Submagic)
    const isSucceeded =
      statusRaw === "succeeded" ||
      statusRaw === "success" ||
      statusRaw === "completed" ||
      statusRaw === "complete";

    if (isSucceeded && video_url) {
      const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
      const SUBMAGIC_TEMPLATE = (process.env.SUBMAGIC_TEMPLATE || "Default").trim();
      const SUBMAGIC_LANGUAGE = (process.env.SUBMAGIC_LANGUAGE || "en").trim();

      // If not configured, mark skipped (optional)
      if (!SUBMAGIC_API_KEY) {
        // only try if these columns exist
        await sb
          .from("renders")
          .update({
            caption_status: "skipped",
            caption_error: "SUBMAGIC_API_KEY_NOT_SET",
          })
          .eq("render_id", render_id);
        return res.status(200).json({ ok: true });
      }

      // Fetch row so we can:
      // - avoid duplicate Submagic creation
      // - pull a nice title from choices
      const { data: row, error: selErr } = await sb
        .from("renders")
        .select("id, submagic_project_id, caption_status, choices")
        .eq("render_id", render_id)
        .maybeSingle();

      if (selErr) {
        console.error("[WEBHOOK] supabase select error", selErr);
        return res.status(500).json({ error: "SUPABASE_SELECT_FAILED" });
      }

      // If row missing, just end (shouldn't happen, but safe)
      if (!row?.id) return res.status(200).json({ ok: true });

      // Already started captions? do nothing
      if (row.submagic_project_id) return res.status(200).json({ ok: true });

      // Mark captioning BEFORE calling Submagic (helps avoid double-start)
      await sb
        .from("renders")
        .update({
          caption_status: "captioning",
          caption_error: null,
        })
        .eq("id", row.id);

      try {
        const choices = row.choices || {};
        const title =
          choices.storyType ||
          choices.customPrompt ||
          "Nofacelabs Video";

        const created = await submagicCreateProject({
          apiKey: SUBMAGIC_API_KEY,
          videoUrl: video_url,
          title,
          language: SUBMAGIC_LANGUAGE,
          templateName: SUBMAGIC_TEMPLATE,
        });

        await sb
          .from("renders")
          .update({
            submagic_project_id: created.id,
            caption_status: created.status || "captioning",
            caption_error: null,
          })
          .eq("id", row.id);

      } catch (e) {
        console.error("[WEBHOOK] submagic error", e);
        await sb
          .from("renders")
          .update({
            caption_status: "failed",
            caption_error: String(e?.message || e),
          })
          .eq("id", row.id);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK] error", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: String(err?.message || err) });
  }
};
