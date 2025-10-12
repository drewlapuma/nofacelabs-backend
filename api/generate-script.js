// api/generate-script.js  (CommonJS)
const { allowCors } = require('../utils/cors');

module.exports = allowCors(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { prompt } = req.body || {};

    // Node 18+ on Vercel has a global fetch. No need for node-fetch.
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: `Write a short video script:\n${prompt || ''}`
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('OpenAI error:', data);
      return res.status(500).json({ error: 'OpenAI request failed', details: data });
    }

    const text =
      data.output_text ||
      data.choices?.[0]?.message?.content ||
      data.choices?.[0]?.text ||
      '';

    return res.status(200).json({ ok: true, text });
  } catch (err) {
    console.error('generate-script error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

