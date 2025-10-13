// /api/generate-script.js  (CommonJS)

module.exports = async (req, res) => {
  const allowOrigin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = typeof req.body === 'object' && req.body
      ? req.body
      : JSON.parse(req.body || '{}');

    // TODO: replace with your OpenAI call
    const script = `Title: ${body?.storyType || 'Untitled'}
Paragraph 1...
Paragraph 2...`;

    return res.status(200).json({ script });
  } catch (err) {
    console.error('GENERATE_SCRIPT error:', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
