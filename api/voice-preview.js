// api/voice-preview.js (CommonJS, Node 18)

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

  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    const XI_API_KEY = process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
    if (!XI_API_KEY) return res.status(500).json({ error: "MISSING_ELEVENLABS_API_KEY" });

    const url = new URL(req.url, `https://${req.headers.host}`);
    const voiceId = String(url.searchParams.get("voiceId") || "").trim();

    if (!voiceId) return res.status(400).json({ error: "MISSING_VOICE_ID" });

    // Keep it short to control cost/latency
    const text =
      String(url.searchParams.get("text") || "").trim() ||
      "This is a quick voice preview from NofaceLabs.";

    const model_id = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

    const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

    const resp = await fetch(elevenUrl, {
      method: "POST",
      headers: {
        "xi-api-key": XI_API_KEY,
        "Content-Type": "application/json",
        "accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5,
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return res.status(resp.status).json({
        error: "ELEVENLABS_TTS_FAILED",
        status: resp.status,
        details: errText.slice(0, 800),
      });
    }

    const buf = Buffer.from(await resp.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    // cache a tiny bit to reduce repeat calls when users spam play
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
