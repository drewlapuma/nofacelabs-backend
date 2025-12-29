// api/creatomate-webhook.js (CommonJS)
// Handles: ?db_id=<uuid>&kind=video|audio|captions

const { getAdminSupabase } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const sb = getAdminSupabase();

  const dbId = String(req.query?.db_id || "").trim();
  const kind = String(req.query?.kind || "video").trim().toLowerCase();

  if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_DB_ID" });

  // Creatomate sends JSON like:
  // { id, status, output, ... } OR { status, output, ... }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const status = String(body?.status || "").toLowerCase();

  const outputUrl =
    body?.output ||
    body?.url ||
    body?.video_url ||
    (Array.isArray(body?.outputs) ? (body.outputs[0]?.url || body.outputs[0]?.output) : null) ||
    null;

  try {
    // Captions render finished
    if (kind === "captions") {
      if (status.includes("fail") || status.includes("error")) {
        await sb.from("renders").update({
          caption_status: "failed",
          caption_error: JSON.stringify(body),
        }).eq("id", dbId);

        return res.status(200).json({ ok: true });
      }

      if (outputUrl && (status.includes("succeed") || status.includes("complete") || status === "done")) {
        await sb.from("renders").update({
          caption_status: "completed",
          captioned_video_url: String(outputUrl),
          caption_error: null,
        }).eq("id", dbId);

        return res.status(200).json({ ok: true });
      }

      // still processing
      await sb.from("renders").update({
        caption_status: status || "captioning",
      }).eq("id", dbId);

      return res.status(200).json({ ok: true });
    }

    // Normal video render finished
    if (kind === "video") {
      if (status.includes("fail") || status.includes("error")) {
        await sb.from("renders").update({ status: "failed", error: JSON.stringify(body) }).eq("id", dbId);
        return res.status(200).json({ ok: true });
      }

      if (outputUrl && (status.includes("succeed") || status.includes("complete") || status === "done")) {
        await sb.from("renders").update({ status: "succeeded", video_url: String(outputUrl) }).eq("id", dbId);
        return res.status(200).json({ ok: true });
      }

      await sb.from("renders").update({ status: status || "rendering" }).eq("id", dbId);
      return res.status(200).json({ ok: true });
    }

    // Audio render finished (optional)
    if (kind === "audio") {
      // store somewhere if you want; otherwise ignore
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always return 200 so Creatomate doesn't retry forever
    return res.status(200).json({ ok: true });
  }
};
