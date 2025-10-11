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
