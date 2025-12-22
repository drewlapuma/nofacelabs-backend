// api/creatomate-webhook.js (CommonJS, Node 18)
const { getAdminSupabase } = require("./_lib/supabase");

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",").map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function pickVideoUrl(body) {
  // Most common possibilities
  if (typeof body.output_url === "string" && body.output_url) return body.output_url;
  if (typeof body.video_url === "string" && body.video_url) return body.video_url;
  if (typeof body.output === "string" && body.output) return body.output;

  // output can be array/object
  const out = body.output || body.outputs || body.result || null;

  // Array of outputs
  if (Array.isArray(out)) {
    const first = out[0];
    if (typeof first === "string") return first;
    if (first && typeof first.url === "string") return first.url;
    if (first && typeof first.file === "string") return first.file;
  }

  // Object output
  if (out && typeof out === "object") {
    if (typeof out.url === "string") return out.url;
    if (typeof out.file === "string") return out.file;
    if (typeof out.mp4 === "string") return out.mp4;
  }

  return null;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const sb = getAdminSupabase();
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    const render_id = String(body.id || body.render_id || "");
    const statusRaw = String(body.status || "");
    const status = statusRaw.toLowerCase();

    if (!render_id) return res.status(400).json({ error: "MISSING_RENDER_ID" });

    const video_url = pickVideoUrl(body);

    const update = {};
    if (status) update.status = status; // or map succeeded->completed if you want
    if (video_url) update.video_url = video_url;

    // Helpful debug while you’re wiring this up (shows in Vercel logs)
    console.log("[WEBHOOK] render_id:", render_id, "status:", statusRaw, "video_url:", video_url ? "YES" : "NO");

    const { error } = await sb.from("renders").update(update).eq("render_id", render_id);
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
