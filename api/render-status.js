// api/render-status.js  (CommonJS)
const { allowCors } = require('../utils/cors');

module.exports = allowCors(async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { id } = req.query || {};
    // TODO: poll Creatomate for the render job status by id

    return res.status(200).json({ ok: true, status: 'pending', id });
  } catch (err) {
    console.error('render-status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});
