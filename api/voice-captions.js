// api/voice-captions.js  (CommonJS, Node 18+)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOW_ORIGIN   = process.env.ALLOW_ORIGIN || '*';

// You can tweak these via env vars if you want later:
const TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';   // example TTS model name
const TTS_VOICE = process.env.TTS_VOICE || 'alloy';             // example voice
const STT_MODEL = process.env.STT_MODEL || 'whisper-1';         // speech-to-text / alignment

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Normalize language names like "English" → ISO-639-1 code like "en"
 */
function normalizeLanguageToIso(langRaw) {
  if (!langRaw) return 'en';
  const s = String(langRaw).trim().toLowerCase();

  if (s === 'en' || s.startsWith('english'))  return 'en';
  if (s === 'es' || s.startsWith('spanish'))  return 'es';
  if (s === 'fr' || s.startsWith('french'))   return 'fr';
  if (s === 'de' || s.startsWith('german'))   return 'de';
  if (s === 'pt' || s.startsWith('portuguese')) return 'pt';
  if (s === 'it' || s.startsWith('italian'))  return 'it';

  // Fallback: default to English
  return 'en';
}

/**
 * Generate TTS audio from narration using OpenAI and return a Buffer.
 */
async function generateTtsAudioBuffer(narration, language) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const text = narration?.trim();
  if (!text) {
    throw new Error('No narration text provided for TTS');
  }

  // We don't strictly need language here, but it's fine to normalize it anyway
  const langCode = normalizeLanguageToIso(language);

  // OpenAI TTS endpoint: /v1/audio/speech
  const resp = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      // If you ever want to pass language explicitly, use langCode
      // language: langCode,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error('[VOICE_CAPTIONS][TTS_ERROR]', resp.status, errText);
    throw new Error(`TTS_FAILED_${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload the audio buffer to Vercel Blob and return a public URL.
 */
async function uploadAudioToBlob(buffer, key) {
  // @vercel/blob is ESM-only, so we use dynamic import
  const { put } = await import('@vercel/blob');

  const { url } = await put(key, buffer, {
    access: 'public',
    addRandomSuffix: true, // audio files can be many, keep them unique
  });

  return url;
}

/**
 * Use Whisper (or similar) to get precise timestamps from the audio.
 * Returns an array: [{ start, end, text }, ...]
 */
async function buildCaptionsFromAudio(audioBuffer, language) {
  if (!OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  // 🔑 Normalize to ISO-639-1 (fixes the "Invalid language 'english'" error)
  const langCode = normalizeLanguageToIso(language);

  // Create a FormData with the audio file
  const form = new FormData();
  // Whisper likes a File/Blob; Node 18 has Blob/File via undici
  const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' });
  form.append('file', audioBlob, 'voiceover.mp3');
  form.append('model', STT_MODEL);
  form.append('response_format', 'verbose_json');

  if (langCode) {
    form.append('language', langCode);
  }

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error('[VOICE_CAPTIONS][STT_ERROR]', resp.status, errText);
    throw new Error(`STT_FAILED_${resp.status}`);
  }

  const data = await resp.json().catch(() => null);
  if (!data || !Array.isArray(data.segments)) {
    console.error('[VOICE_CAPTIONS][STT_BAD_RESPONSE]', data);
    throw new Error('STT_NO_SEGMENTS');
  }

  // Map Whisper segments → caption chunks
  const captions = data.segments
    .map((seg) => ({
      start: typeof seg.start === 'number' ? seg.start : 0,
      end:   typeof seg.end === 'number'   ? seg.end   : 0,
      text:  (seg.text || '').trim(),
    }))
    .filter((c) => c.text);

  return captions;
}

/**
 * HTTP handler
 */
module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const narration = (body.narration || '').trim();
    const rawLanguage = (body.language || 'en').trim();
    const language = normalizeLanguageToIso(rawLanguage);

    if (!narration) {
      return res.status(400).json({ error: 'MISSING_NARRATION' });
    }

    console.log('[VOICE_CAPTIONS] INPUT', {
      narrationLen: narration.length,
      rawLanguage,
      languageIso: language,
    });

    // 1) TTS → audio buffer
    const audioBuffer = await generateTtsAudioBuffer(narration, language);

    // 2) Upload audio to Blob → voiceUrl
    const key = `voiceovers/${Date.now()}-voiceover.mp3`;
    const voiceUrl = await uploadAudioToBlob(audioBuffer, key);

    // 3) STT → precise captions
    const captions = await buildCaptionsFromAudio(audioBuffer, language);

    console.log('[VOICE_CAPTIONS] DONE', {
      voiceUrlPreview: voiceUrl.slice(0, 60) + '…',
      captionCount: captions.length,
    });

    return res.status(200).json({
      ok: true,
      voiceUrl,
      captions,
      language,     // ISO code actually used
    });
  } catch (err) {
    console.error('[VOICE_CAPTIONS] SERVER_ERROR', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: String(err?.message || err),
    });
  }
};
