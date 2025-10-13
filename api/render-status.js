// /api/render-status.js  (CommonJS)

module.exports = async (req, res) => {
  // --- CORS ---
  const allowOrigin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const job_id = (req.query && req.query.job_id) || (req.query && req.query.id);
    if (!job_id) return res.status(400).json({ error: 'MISSING_JOB_ID' });

    const r = await fetch(`https://api.creatomate.com/v1/renders/${job_id}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${process.env.CREATOMATE_API_KEY}` }
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('RENDER_STATUS Creatomate error:', data);
      return res.status(502).json({ error: 'CREATOMATE_ERROR', detail: data });
    }

    // data.status typically 'queued' | 'rendering' | 'succeeded' | 'failed'
    // data.url or data.result_url may hold the MP4 when done
    return res.status(200).json({
      status: data?.status,
      url:    data?.url || data?.result_url || null,
      raw:    data
    });
  } catch (err) {
    console.error('RENDER_STATUS handler error:', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
