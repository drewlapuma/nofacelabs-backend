// /api/create-video.js (or .ts)
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    // you can log here if you want, but it’s not necessary
    return res.status(200).end();
  }

  try {
    console.log('CREATE_VIDEO start', { method: req.method, headers: req.headers });

    // If you use Next.js API routes with bodyParser: true, use req.body.
    // If you're using Edge runtime or fetch-style, you'll need await req.json()
    const body = req.body ?? {};
    console.log('CREATE_VIDEO body', body);

    // >>> your Creatomate call here <<<
    // const result = await creatomate.renders.create({...});
    // assume it returns { id: 'rdr_...' }

    const jobId = result.id;
    console.log('CREATE_VIDEO job id', jobId);

    res.status(200).json({ job_id: jobId });
  } catch (err) {
    console.error('CREATE_VIDEO error', err?.response?.data || err?.message || err);
    res.status(500).json({ error: 'create_failed' });
  }
}
