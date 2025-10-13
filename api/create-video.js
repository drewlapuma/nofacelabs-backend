// /api/create-video.js  (CommonJS)

module.exports = async (req, res) => {
  // --- CORS ---
  const allowOrigin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')  return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = typeof req.body === 'object' && req.body
      ? req.body
      : JSON.parse(req.body || '{}');

    // Map aspect ratio -> Creatomate template id (set these in Vercel env)
    const TEMPLATES = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1' : process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };

    const aspect = (body.aspectRatio || '9:16').trim();
    const template_id = TEMPLATES[aspect];

    if (!template_id) {
      console.error('CREATE_VIDEO: missing template for aspect', aspect);
      return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspect });
    }

    // Build Creatomate payload (keys must match your template layer names)
    const payload = {
      template_id,
      modifications: {
        // Adjust names to match your Creatomate layers exactly
        Headline:  body.headline   || 'Sample Headline',
        image_url: body.imageUrl   || 'https://picsum.photos/1080/1920',
        voice_url: body.voiceUrl   || null
      }
    };

    console.log('CREATE_VIDEO payload ->', JSON.stringify(payload));

    const r = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('CREATE_VIDEO Creatomate error:', data);
      return res.status(502).json({ error: 'CREATOMATE_ERROR', detail: data });
    }

    // Creatomate usually returns { id, ... } or an array
    const jobId = data?.id ?? (Array.isArray(data) ? data[0]?.id : undefined);
    if (!jobId) {
      console.error('CREATE_VIDEO no job id in response:', data);
      return res.status(502).json({ error: 'NO_JOB_ID', raw: data });
    }

    console.log('CREATE_VIDEO job_id ->', jobId);
    return res.status(200).json({ job_id: jobId });
  } catch (err) {
    console.error('CREATE_VIDEO handler error:', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
// /api/create-video.js  (CommonJS)
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

module.exports = async (req, res) => {
  try {
    // Allow CORS (adjust origin to your domain)
    res.setHeader('Access-Control-Allow-Origin', 'https://nofacelabsai.webflow.io');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    const {
      storyType,
      customPrompt,
      voice,
      language,
      durationSec,
      aspectRatio,      // expected '9:16', '1:1', or '16:9'
      artStyle
    } = req.body || {};

    // Normalize aspect input in case UI sends labels like "Vertical (9:16)"
    const aspect = String(aspectRatio || '').replace(/[^\d:]/g, ''); // -> '9:16', '1:1', '16:9'

    const TEMPLATE_IDS = {
      '9:16': process.env.CREATOMATE_TPL_916,
      '1:1' : process.env.CREATOMATE_TPL_11,
      '16:9': process.env.CREATOMATE_TPL_169,
    };

    const templateId = TEMPLATE_IDS[aspect];

    if (!templateId) {
      return res.status(400).json({
        error: 'NO_TEMPLATE_FOR_ASPECT',
        details: {
          aspectReceived: aspectRatio,
          aspectNormalized: aspect,
          availableFor: Object.entries(TEMPLATE_IDS)
            .filter(([,v]) => !!v)
            .map(([k]) => k)
        }
      });
    }

    // --- build Creatomate payload ---
    const payload = {
      template_id: templateId,
      // put your dynamic modifications here to match your template layer names
      modifications: {
        Headline: customPrompt && customPrompt.trim()
          ? customPrompt.trim()
          : 'Sample Headline',
        image_url: 'https://picsum.photos/1080/1920',
        voice_url: null, // set after you produce TTS
      },
      // optional settings
      webhook: null,
    };

    // Call Creatomate
    const r = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json();

    // json should include { id, status, ... } when accepted
    if (!r.ok || !json?.id) {
      return res.status(502).json({
        error: 'CREATOMATE_CREATE_FAILED',
        status: r.status,
        body: json
      });
    }

    return res.status(200).json({ job_id: json.id });
  } catch (err) {
    console.error('CREATE_VIDEO error', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
