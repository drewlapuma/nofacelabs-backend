// api/render-status.js
export default async function handler(req, res) {
  // Allowed origins (edit these as needed)
  const allowed = new Set([
    'https://nofacelabsai.webflow.io',
    'https://www.nofacelabs.ai',     // your custom domain if/when live
  ]);

  const origin = req.headers.origin;
  if (allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');

  // IMPORTANT: include cache-control and common headers
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Cache-Control, X-Requested-With, Accept'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400'); // cache preflight

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const id = req.query.id || req.query.job_id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Call Creatomate
    const r = await fetch(
      `https://api.creatomate.com/v1/renders/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` } }
    );
    const data = await r.json();
    // You’ll get 200 with the render payload (or an error shape from Creatomate)
    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    console.error('STATUS ERROR', e);
    return res.status(500).json({ error: 'STATUS_FAILED' });
  }
}
