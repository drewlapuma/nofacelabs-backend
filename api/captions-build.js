// api/captions-build.js
// POST /api/captions-build { audioUrl, mode: "sentence"|"word" }
// returns { ok, mode, items, text }

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

function normalizeSegments(segments = []) {
  return segments
    .filter(s => Number.isFinite(+s.start) && Number.isFinite(+s.end) && s.text)
    .map((s, i) => ({
      id: `seg_${i}`,
      start: +s.start,
      end: +s.end,
      duration: Math.max(0.01, (+s.end - +s.start)),
      text: String(s.text).trim(),
    }));
}

function normalizeWords(words = []) {
  return words
    .filter(w => Number.isFinite(+w.start) && Number.isFinite(+w.end) && w.word)
    .map((w, i) => ({
      id: `w_${i}`,
      start: +w.start,
      end: +w.end,
      duration: Math.max(0.01, (+w.end - +w.start)),
      text: String(w.word).trim(),
    }));
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const audioUrl = String(body.audioUrl || "").trim();
    const mode = String(body.mode || "sentence").trim(); // "sentence" | "word"

    if (!audioUrl) return res.status(400).json({ ok: false, error: "MISSING_AUDIO_URL" });

    // Call your existing transcribe endpoint
    const API_BASE = process.env.API_BASE || ""; // optional
    const transcribeUrl = API_BASE ? `${API_BASE}/api/transcribe` : `https://${req.headers.host}/api/transcribe`;

    const r = await fetch(transcribeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioUrl }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return res.status(500).json({ ok: false, error: "TRANSCRIBE_FAILED", detail: j });

    const text = j.text || "";
    const segments = normalizeSegments(j.segments || []);
    const words = normalizeWords(j.words || []);

    const items = mode === "word" ? words : segments;

    return res.status(200).json({ ok: true, mode, text, items });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
