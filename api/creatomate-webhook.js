// api/creatomate-webhook.js
const { getAdminSupabase } = require("./_lib/supabase");

// Webhook is server-to-server; CORS not required, but harmless
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

    const update = {};
    if (statusRaw) update.status = statusRaw; // e.g. "succeeded"
    if (video_url) update.video_url = video_url;

    const { error } = await sb.from("renders").update(update).eq("render_id", render_id);

    if (error) {
      console.error("[WEBHOOK] supabase update error", error);
      return res.status(500).json({ error: "SUPABASE_UPDATE_FAILED" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK] error", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: String(err?.message || err) });
  }
};
