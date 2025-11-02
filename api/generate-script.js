// api/generate-script.js (CommonJS) — drop-in replacement

module.exports = async (req, res) => {
  // --- CORS (keeps your current style)
  const allowOrigin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    // Accept either a string or parsed JSON body
    const body = typeof req.body === 'object' && req.body
      ? req.body
      : JSON.parse(req.body || '{}');

    // Read actual user selections; provide broad, safe defaults
    const storyType   = String(body.storyType   || '').trim() || 'General';
    const artStyle    = String(body.artStyle    || '').trim() || 'Realistic';
    const language    = String(body.language    || '').trim() || 'English';
    const voiceTone   = String(body.voiceTone   || body.voice || '').trim(); // optional
    const customHint  = String(body.customPrompt|| '').trim();               // optional
    const beatsAsked  = Number(body.targetBeats || body.beats || 0) || 6;    // 4–10 recommended

    // Clamp to a sensible range
    const targetBeats = Math.max(4, Math.min(10, beatsAsked));

    // Optional: brief duration hint to help pacing
    const perBeatSec  = Number(body.perBeatSec || 0) || 10; // used only as guidance in prompt

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'MISSING_OPENAI_API_KEY' });
    }

    // Build a strict-JSON prompt so we can parse reliably
    const system = `You are a concise story-beat generator for short videos. 
Return STRICT JSON only; no prose, no markdown.`;

    const user = `
Create a ${targetBeats}-beat "${storyType}" micro-story in ${language}.
If helpful, consider this extra guidance: "${customHint || 'n/a'}".

Voice & tone: ${voiceTone || 'inspirational, clear, conversational'}.
Style for visuals: ${artStyle}.

Each beat should:
- include a short on-screen caption (3–9 words)
- include an "imagePrompt" that a renderer can use to fetch or generate a relevant image for that beat (avoid copyrighted names; describe the scene clearly)

Total target length hint: about ${perBeatSec} seconds per beat.

Return STRICT JSON with this shape:
{
  "narration": "<70–160 words that reads smoothly as a single voiceover>",
  "beats": [
    { "caption": "<3–9 words>", "imagePrompt": "<visual description for this beat>" }
  ]
}
No additional keys. No comments. No markdown.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user }
        ],
        // Force valid JSON
        response_format: { type: 'json_object' },
        temperature: 0.8,
      }),
    });

    const j = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: 'OPENAI_ERROR', details: j });
    }

    // Parse the model's JSON
    let raw = j?.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(502).json({ error: 'PARSE_ERROR', raw });
    }

    // Normalize + guardrails
    const narration = String(parsed.narration || '').trim();
    const beats = Array.isArray(parsed.beats) ? parsed.beats.slice(0, 12) : [];

    // Minimal validation
    const cleanedBeats = beats
      .map((b, i) => ({
        caption: String(b?.caption || '').trim().slice(0, 80) || `Scene ${i+1}`,
        imagePrompt: String(b?.imagePrompt || '').trim().slice(0, 200) || `A ${artStyle} scene that fits ${storyType} beat ${i+1}`,
      }))
      .filter(Boolean);

    if (!narration || cleanedBeats.length < 2) {
      return res.status(502).json({ error: 'SCRIPT_TOO_THIN', got: { narrationLen: narration.length, beats: cleanedBeats.length } });
    }

    // Final response shape your /api/create-video.js expects
    return res.status(200).json({
      narration,
      beats: cleanedBeats
    });

  } catch (err) {
    console.error('[GENERATE_SCRIPT] error', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
