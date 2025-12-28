// api/creatomate-webhook.js
const { getAdminSupabase } = require("./_lib/supabase");

// Safely read webhook body (Creatomate may send array)
function normalizeBody(raw) {
  const body = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
  return Array.isArray(body) ? (body[0] || {}) : body;
}

// Creatomate output can appear in multiple shapes
function extractOutputUrl(body) {
  return (
    body?.output ||
    body?.url ||
    body?.video_url ||
    (Array.isArray(body?.outputs) ? (body.outputs[0]?.url || body.outputs[0]?.output) : null) ||
    null
  );
}

module.exports = async function handler(req, res) {
  // Creatomate may hit OPTIONS sometimes
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const sb = getAdminSupabase();

    const q = req.query || {};
    const db_id = String(q.db_id || "").trim();       // passed from webhook_url querystring
    const kind = String(q.kind || "video").trim();    // "video" or "audio"

    const body = normalizeBody(req.body);

    const render_id = String(body?.id || body?.render_id || "").trim();
    const statusRaw = String(body?.status || "").toLowerCase();
    const outputUrl = extractOutputUrl(body);

    if (!render_id) return res.status(400).json({ error: "MISSING_RENDER_ID" });

    // Build update payload
    const update = {};
    if (statusRaw) update.status = statusRaw;

    // If this webhook is for the VIDEO render, save video_url + render_id (the main job)
    if (kind === "video") {
      if (outputUrl) update.video_url = outputUrl;
      // Only set render_id if you’re using render_id as “main video render”
      update.render_id = render_id;

      // If you want captions to be "not_started" by default when video is ready:
      if (statusRaw === "succeeded" && outputUrl) {
        update.caption_status = "not_started";
        update.caption_error = null;
      }
    }

    // If this webhook is for the AUDIO render, store into choices.audio_url
    // (since you said you don’t store audio elsewhere)
    let choicesPatch = null;
    if (kind === "audio" && outputUrl) {
      // We need the row first so we can merge choices cleanly
      let row = null;
      if (db_id) {
        const { data } = await sb.from("renders").select("id, choices").eq("id", db_id).maybeSingle();
        row = data || null;
      } else {
        // fallback: try match by render_id (less reliable if render_id is the VIDEO id)
        const { data } = await sb.from("renders").select("id, choices").eq("render_id", render_id).maybeSingle();
        row = data || null;
      }

      if (row?.id) {
        const currentChoices = row.choices || {};
        choicesPatch = {
          ...currentChoices,
          audio_url: outputUrl,
          audio_render_id: render_id,
        };

        // update choices on the same row
        const { error: updChoicesErr } = await sb
          .from("renders")
          .update({ choices: choicesPatch })
          .eq("id", row.id);

        if (updChoicesErr) {
          console.error("[WEBHOOK] choices update error", updChoicesErr);
          // still continue; we can also update the video part below if needed
        }
      }
    }

    // Apply the main update:
    // Prefer db_id if provided, otherwise fall back to render_id match
    let updErr = null;
    if (db_id) {
      const { error } = await sb.from("renders").update(update).eq("id", db_id);
      updErr = error;
    } else {
      const { error } = await sb.from("renders").update(update).eq("render_id", render_id);
      updErr = error;
    }

    if (updErr) {
      console.error("[WEBHOOK] supabase update error", updErr);
      return res.status(500).json({ error: "SUPABASE_UPDATE_FAILED" });
    }

    return res.status(200).json({
      ok: true,
      kind,
      render_id,
      status: statusRaw || null,
      outputUrl: outputUrl || null,
      storedAudioInChoices: Boolean(kind === "audio" && outputUrl),
    });
  } catch (err) {
    console.error("[WEBHOOK] error", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: String(err?.message || err) });
  }
};

