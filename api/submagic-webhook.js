// api/creatomate-webhook.js (CommonJS)
const { getAdminSupabase } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  // Creatomate sends POST
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const sb = getAdminSupabase();

  const dbId = String(req.query?.db_id || "").trim();
  const kind = String(req.query?.kind || "video").trim(); // video | audio | captions

  if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_DB_ID" });

  // Creatomate body typically includes: { id, status, url/output, error }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const status = String(body?.status || "").toLowerCase();

  // Try common output fields
  const outUrl =
    body?.url ||
    body?.output ||
    body?.video_url ||
    (Array.isArray(body?.outputs) ? (body.outputs[0]?.url || body.outputs[0]?.output) : null) ||
    null;

  try {
    if (status.includes("fail") || status.includes("error")) {
      const errMsg = String(body?.error || body?.message || "CREATOMATE_RENDER_FAILED");

      if (kind === "captions") {
        await sb.from("renders").update({
          caption_status: "failed",
          caption_error: errMsg,
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          status: "failed",
          error: errMsg,
        }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // Completed
    if (status.includes("succeed") || status.includes("complete") || status === "done") {
      if (kind === "captions") {
        await sb.from("renders").update({
          caption_status: "completed",
          captioned_video_url: outUrl || null,
          caption_error: null,
        }).eq("id", dbId);
      } else if (kind === "audio") {
        // optional if you store it
        await sb.from("renders").update({
          audio_url: outUrl || null,
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          status: "succeeded",
          video_url: outUrl || null,
          error: null,
        }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // Still processing
    if (kind === "captions") {
      await sb.from("renders").update({
        caption_status: "captioning",
      }).eq("id", dbId);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 so Creatomate doesn't retry forever
    return res.status(200).json({ ok: true });
  }
};
