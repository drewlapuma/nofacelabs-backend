// api/transcribe.js
// POST /api/transcribe { audioUrl: "https://..." } -> transcription JSON
// Handles CORS + OPTIONS (preflight)

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

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

module.exports = async function handler(req, res) {
  // ✅ CORS MUST BE FIRST
  setCors(req, res);

  // ✅ Preflight must return success
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const audioUrl = String(body?.audioUrl || "").trim();
    if (!audioUrl) return res.status(400).json({ ok: false, error: "MISSING_AUDIO_URL" });

    // TODO: put your actual transcription provider call here
    // For now this just returns the url so we can confirm CORS works.
    return res.status(200).json({ ok: true, audioUrl, note: "CORS fixed. Now wire transcription provider here." });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
