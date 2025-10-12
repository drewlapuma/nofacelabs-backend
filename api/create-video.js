// /api/create-video.js  (CommonJS)
const fetch = global.fetch || require('node-fetch'); // Vercel has fetch in Node 18+, but this keeps it safe

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  // CORS for normal request
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  try {
    // If you’re on Next.js “old” API routes, req.body is already parsed.
    // (If you switched to Edge runtime or something custom, you’d need await req.json().)
    const body = req.body || {};
    console.log('CREATE_VIDEO body:', body);

    // --- Minimal Creatomate render request ---
    // Make sure you set CREATOMATE_API_KEY in Vercel → Project → Settings → Environment Variables
    const apiKey = process.env.CREATOMATE_API_KEY;
    if (!apiKey) {
      console.error('Missing CREATOMATE_API_KEY');
      return res.status(500).json({ error: 'missing_api_key' });
    }

    // Build a basic payload; customize from your template
    const payload = {
      template_id: process.env.CREATOMATE_TEMPLATE_ID, // or use "template" if you send the full JSON
      // dynamic data you want to inject:
      modifications: {
        // e.g., match your layer names:
        Headline: body.headline || 'Sample Headline',
        image_url: body.image_url || 'https://picsum.photos/1080/1920',
        voice_url: body.voice_url || null, // if you already have TTS URL
      }
    };

    console.log('CREATE_VIDEO calling Creatomate with payload:', payload);

    const cr = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const json = await cr.json();
    console.log('CREATE_VIDEO Creatomate raw response:', json);

    // Creatomate usually returns an object with id/status or an array (depending on endpoint).
    // If it’s an array, take json[0].id; if it’s an object, take json.id.
    const jobId = Array.isArray(json) ? json[0]?.id : json?.id;

    if (!jobId) {
      console.error('CREATE_VIDEO no job id found in response');
      return res.status(502).json({ error: 'no_job_id', raw: json });
    }

    console.log('CREATE_VIDEO job id:', jobId);
    return res.status(200).json({ job_id: jobId });
  } catch (err) {
    // Log everything you can
    console.error('CREATE_VIDEO error:', err?.response?.data || err?.message || err);
    return res.status(500).json({ error: 'create_failed' });
  }
};
