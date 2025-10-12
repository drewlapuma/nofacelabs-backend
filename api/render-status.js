export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const jobId = req.query.job_id;
    console.log('RENDER_STATUS check', jobId);

    // const status = await creatomate.renders.retrieve(jobId);
    // console.log('RENDER_STATUS result', status);

    res.status(200).json(status);
  } catch (err) {
    console.error('RENDER_STATUS error', err?.response?.data || err?.message || err);
    res.status(500).json({ error: 'status_failed' });
  }
}
