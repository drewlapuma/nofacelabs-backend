// api/create-video.js
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

  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  if (!CREATOMATE_API_KEY) return res.status(500).json({ error: 'Missing CREATOMATE_API_KEY' });

  try {
    const { templateId, script, imageUrl, audioUrl } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'Missing templateId' });

    // 👇 change these selectors to your actual layer names in Creatomate
    const modifications = [];
    if (script)   modifications.push({ selector: 'name:Text-KWT', text: script });
    if (imageUrl) modifications.push({ selector: 'name:Image-BXJ', image: imageUrl });
    if (audioUrl) modifications.push({ selector: 'name:Voiceover-J28', audio: audioUrl });

    const r = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ templateId, modifications })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error || 'Creatomate start failed' });

    res.json({ renderId: data.id });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
