// Minimal create-video endpoint to prove the route works

const ALLOWED = new Set([
  'https://nofacelabsai.webflow.io', // your Webflow domain
  // 'http://localhost:3000',        // add if you test locally
  // 'https://your-custom-domain.com'
]);

function setCORS(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      setCORS(req, res);
      return res.status(200).end();
    }

    setCORS(req, res);

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Body might come as object or string
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try { body = JSON.parse(req.body || '{}'); } catch { body = {}; }
    }

    console.log('create-video body:', body);

    return res.status(200).json({
      ok: true,
      body,
      env: {
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasCreatomate: !!process.env.CREATOMATE_API_KEY,
        hasElevenLabs: !!process.env.ELEVENLABS_API_KEY
      }
    });
  } catch (err) {
    console.error('create-video failed:', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
};
