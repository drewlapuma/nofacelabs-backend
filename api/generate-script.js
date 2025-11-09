// api/generate-script.js  (CommonJS)

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const {
      storyType   = 'Motivational',
      artStyle    = 'Scary toon',
      language    = 'English',
      targetBeats = 6,
    } = body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'MISSING_OPENAI_API_KEY' });
    }

    // --- Call OpenAI to generate narration + beats ---

    const prompt = `
Generate a short ${language} ${storyType} story for a vertical social media video.

Requirements:
- Total spoken length: about 45–90 seconds.
- Split the story into ${targetBeats} beats (scenes).
- Return STRICT JSON with this exact schema:
  {
    "narration": string,           // full voiceover script for the entire video
    "beats": [
      {
        "caption": string,         // 1–2 sentence on-screen text for this beat
        "imagePrompt": string      // English visual prompt for the scene (no text overlays)
      },
      ...
    ]
  }

Guidelines:
- Narration should be engaging and coherent as one story.
- Each beat should move the story forward.
- imagePrompt should describe the visual in detail (scene, lighting, mood, style: ${artStyle}).
- Do NOT include any backticks or code fences in the response.
`;

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',   // you can change to another chat model if you like
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You write short narration scripts and scene beats for TikTok-style videos. ' +
              'Always respond with STRICT JSON only, no explanations, no markdown.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    const openaiJson = await openaiRes.json();
    if (!openaiRes.ok) {
      console.error('OPENAI_ERROR', openaiRes.status, openaiJson);
      return res.status(502).json({ error: 'OPENAI_ERROR', details: openaiJson });
    }

    let data;
    try {
      const content = openaiJson?.choices?.[0]?.message?.content || '';
      data = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (e) {
      console.error('PARSE_ERROR', e, openaiJson);
      return res.status(502).json({ error: 'PARSE_ERROR', details: String(e) });
    }

    const narration = data?.narration;
    const beats = Array.isArray(data?.beats) ? data.beats : [];

    if (!narration || !beats.length) {
      console.error('SCRIPT_EMPTY', { narrationExists: !!narration, beatsLen: beats.length });
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: { narration, beats } });
    }

    // Optionally trim to max 10 beats (match how many scenes you built)
    const trimmedBeats = beats.slice(0, 10);

    return res.status(200).json({
      narration,
      beats: trimmedBeats.map((b, i) => ({
        caption: b.caption || `Part ${i + 1} of the story.`,
        imagePrompt: b.imagePrompt || `${storyType} scene ${i + 1}, ${artStyle} style`,
      })),
    });
  } catch (err) {
    console.error('GENERATE_SCRIPT error', err);
    return res
      .status(500)
      .json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
