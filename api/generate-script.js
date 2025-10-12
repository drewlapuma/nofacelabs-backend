// api/generate-script.js
import { withCORS } from '../utils/cors';

async function handler(req, res) {
  // --- your existing logic here ---
  // For example:
  // if (req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  // const body = req.body;
  // ... do stuff ...
  return res.status(200).json({ ok: true });
}

export default withCORS(handler); // ✅ adds headers + handles OPTIONS
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const {
    storyType = 'Motivational',
    customPrompt = '',
    voice = 'Neutral',
    artStyle = 'Clean',
    aspect = '9:16',
    language = 'English',
    durationSeconds = 60
  } = req.body || {};

  const system = `You are a short-video scriptwriter.
  Return only the script. Target ${durationSeconds}s. Language: ${language}.
  Style: ${artStyle}. Aspect: ${aspect}. Voice hint: ${voice}.
  If storyType is "Custom Prompt", follow it exactly.`;

  const user = customPrompt.trim()
    ? `Custom prompt:\n${customPrompt}`
    : `Write a ${storyType} script for ~${durationSeconds}s.`;

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        max_output_tokens: 800
      })
    });
    const data = await r.json();

    const script =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      data.choices?.[0]?.message?.content ||
      '';

    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'OpenAI error' });

    res.json({ script: script.trim() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://nofacelabsai.webflow.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // TODO: call OpenAI(gpt-5-mini) to generate the script
    return res.status(200).json({ ok: true, route: 'generate-script' });
  } catch (err) {
    console.error('generate-script error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
