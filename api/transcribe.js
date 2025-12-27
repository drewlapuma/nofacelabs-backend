// api/transcribe.js
// POST /api/transcribe { audioUrl: "https://..." , language?: "en" }
// Returns: { ok:true, text, segments, words }

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

function guessFileName(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "audio";
    return last.includes(".") ? last : `${last}.mp3`;
  } catch {
    return "audio.mp3";
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
    if (!OPENAI_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_OPENAI_API_KEY" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const audioUrl = String(body?.audioUrl || "").trim();
    const language = String(body?.language || "en").trim();

    if (!audioUrl) return res.status(400).json({ ok: false, error: "MISSING_AUDIO_URL" });

   // 1) Download the audio file
const audioResp = await fetch(audioUrl, { redirect: "follow" });
if (!audioResp.ok) {
  const txt = await audioResp.text().catch(() => "");
  return res.status(400).json({
    ok: false,
    error: "AUDIO_FETCH_FAILED",
    status: audioResp.status,
    statusText: audioResp.statusText,
    hint: "audioUrl must be a direct, public file URL (mp3/wav).",
    audioUrl,
    responseBodyPreview: txt.slice(0, 300),
  });
}


    const contentType = audioResp.headers.get("content-type") || "audio/mpeg";
    const buf = await audioResp.arrayBuffer();
    const fileName = guessFileName(audioUrl);

    // 2) Send to OpenAI transcription
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("language", language);

    // IMPORTANT: for word timestamps, must use verbose_json + timestamp_granularities
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");

    // File field must be a real file/blob
    form.append("file", new Blob([buf], { type: contentType }), fileName);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: form,
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_TRANSCRIBE_FAILED",
        message: j?.error?.message || j?.message || `HTTP_${r.status}`,
        raw: j,
      });
    }

    // whisper-1 verbose_json includes: text, segments[], and if requested, words[] inside segments
    const text = j?.text || "";
    const segments = Array.isArray(j?.segments) ? j.segments : [];

    // Flatten words if present
    const words = [];
    for (const seg of segments) {
      if (Array.isArray(seg?.words)) {
        for (const w of seg.words) {
          words.push({
            word: w.word,
            start: w.start,
            end: w.end,
          });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      text,
      segments,
      words,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
