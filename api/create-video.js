// api/create-video.js  (CommonJS)
const { allowCors } = require('../utils/cors');

module.exports = allowCors(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { storyType, voiceId, language, duration, aspect, customPrompt } = req.body || {};

    // TODO: your real Creatomate / ElevenLabs calls here

    return res.status(200).json({ ok: true, route: 'create-video' });
  } catch (err) {
    console.error('create-video error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});
