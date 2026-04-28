const ELEVEN_BASE = "https://api.elevenlabs.io/v1";

function getApiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Missing ELEVENLABS_API_KEY");
  return key;
}

// Default voice (you can swap this later with your UI selection)
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // ElevenLabs default

async function generateVoiceAudio({
  text,
  voiceId = DEFAULT_VOICE_ID,
  speed = 1,
}) {
  const apiKey = getApiKey();

  const res = await fetch(
    `${ELEVEN_BASE}/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          speed: speed || 1,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[voice] elevenlabs error:", err);
    throw new Error("Voice generation failed");
  }

  const buffer = await res.arrayBuffer();

  // ⚠️ TEMP: we return a base64 data URL (fastest way to test)
  const base64 = Buffer.from(buffer).toString("base64");

  return {
    url: `data:audio/mpeg;base64,${base64}`,
    duration: null, // we’ll improve later
  };
}

module.exports = {
  generateVoiceAudio,
};
