const { createClient } = require("@supabase/supabase-js");

const ELEVEN_BASE = "https://api.elevenlabs.io/v1";
const BUCKET = "skeleton-assets";

function getElevenKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Missing ELEVENLABS_API_KEY");
  return key;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase env vars for voice upload");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

async function generateVoiceAudio({
  text,
  voiceId,
  speed = 1,
  jobId = "skeleton-job",
}) {
  const safeVoiceId =
    !voiceId || voiceId === "default" ? DEFAULT_VOICE_ID : voiceId;

  const elevenRes = await fetch(`${ELEVEN_BASE}/text-to-speech/${safeVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": getElevenKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(text || "").trim(),
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        speed: Number(speed) || 1,
      },
    }),
  });

  if (!elevenRes.ok) {
    const errText = await elevenRes.text().catch(() => "");
    console.error("[skeleton-voice] ElevenLabs failed", errText);
    throw new Error("Voice generation failed");
  }

  const audioBuffer = Buffer.from(await elevenRes.arrayBuffer());

  const supabase = getSupabase();
  const path = `voices/${jobId}-${Date.now()}.mp3`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, audioBuffer, {
      contentType: "audio/mpeg",
      upsert: true,
    });

  if (uploadError) {
    console.error("[skeleton-voice] Supabase upload failed", uploadError);
    throw new Error("Voice upload failed");
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error("Could not create public voice URL");
  }

  return {
    url: data.publicUrl,
    path,
  };
}

module.exports = {
  generateVoiceAudio,
};
