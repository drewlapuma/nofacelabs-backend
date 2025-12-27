const OpenAI = require("openai");

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const { audioUrl } = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!audioUrl) return res.status(400).json({ ok: false, error: "MISSING_AUDIO_URL" });

    // Download audio into memory
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) {
      return res.status(400).json({ ok: false, error: "AUDIO_FETCH_FAILED" });
    }

    const arrayBuffer = await audioResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create a File-like object for the SDK
    const file = new File([buffer], "voiceover.mp3", { type: "audio/mpeg" });

    const transcript = await client.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      response_format: "verbose_json",
      timestamp_granularities: ["word"]
    });

    return res.status(200).json({ ok: true, transcript });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
