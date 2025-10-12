// api/render-status.js
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
  const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const r = await fetch(`https://api.creatomate.com/v1/renders/${id}`, {
    headers: { 'Authorization': `Bearer ${CREATOMATE_API_KEY}` }
  });
  const d = await r.json();
  if (!r.ok) return res.status(r.status).json({ error: d.error || 'Creatomate error' });

  res.json({ status: d.status, url: d.url || null, progress: d.progress || 0 });
}
