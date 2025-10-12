// api/create-video.js  (temporary debug build)

const ALLOWED = new Set([
  'https://nofacelabsai.webflow.io', // your Webflow site
  // 'http://localhost:3000',         // add if testing locally
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
  const started = new Date().toISOString();
  try {
    if (req.method === 'OPTIONS') {
      setCORS(req, res);
      return res.status(200).end();
    }

    setCORS(req, res);

    // Parse body safely
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try { body = JSON.parse(req.body || '{}'); } catch { body = {}; }
    }

    // Echo back everything we care about
    return res.status(200).json({
      ok: true,
      started,
      method: req.method,
      path: req.url || '/api/create-video',
      headers: {
        origin: req.headers.origin || null,
        'content-type': req.headers['content-type'] || null,
      },
      body,
      env: {
        has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
        has_CREATOMATE_API_KEY: !!process.env.CREATOMATE_API_KEY,
        has_ELEVENLABS_API_KEY: !!process.env.ELEVENLABS_API_KEY,
      }
    });

  } catch (err) {
    // Return error details in the response so you can see them without logs
    return res.status(500).json({
      ok: false,
      started,
      error: String(err?.message || err),
      stack: (err && err.stack) ? String(err.stack) : null
    });
  }
};
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://nofacelabsai.webflow.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // TODO: call Creatomate render / kick off job, etc.
    return res.status(200).json({ ok: true, route: 'create-video' });
  } catch (err) {
    console.error('create-video error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
