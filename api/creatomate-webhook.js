// api/creatomate-webhook.js (CommonJS, Node 18)
const { getAdminSupabase } = require("./_lib/supabase");

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const sb = getAdminSupabase();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    // Creatomate typically sends: { id, status, output, ... }
    const render_id = String(body.id || body.render_id || "");
    const status = String(body.status || "").toLowerCase();
    const video_url = body.output || body.video_url || null;

    if (!render_id) return res.status(400).json({ error: "MISSING_RENDER_ID" });

    const update = {};
    if (status) update.status = status;
    if (video_url) update.video_url = video_url;

    // Map statuses if you want:
    // if (status === "succeeded") update.status = "completed";
    // if (status === "failed") update.status = "failed";

    const { error } = await sb
      .from("renders")
      .update(update)
      .eq("render_id", render_id);

    if (error) {
      console.error("[WEBHOOK] supabase update error", error);
      return res.status(500).json({ error: "SUPABASE_UPDATE_FAILED" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[WEBHOOK] error", err);
    return res.status(500).json({ error: "SERVER_ERROR", message: String(err.message || err) });
  }
};
