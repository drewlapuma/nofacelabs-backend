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
// /api/create-video.js  (CommonJS)
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

module.exports = async (req, res) => {
  // --- CORS (adjust origin to your real site) ---
  res.setHeader('Access-Control-Allow-Origin', 'https://nofacelabsai.webflow.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const debug = (...m) => console.log('[CREATE_VIDEO]', ...m);

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }

    // Ensure body exists and is JSON
    if (!req.body || typeof req.body !== 'object') {
      debug('NO_BODY_OR_NOT_JSON', { hasBody: !!req.body });
      return res.status(400).json({ error: 'NO_BODY_OR_NOT_JSON' });
    }

    const {
      storyType,
      customPrompt,
      voice,
      language,
      durationSec,
      aspectRatio,   // ex: '9:16', '1:1', '16:9'  (or UI label like 'Vertical (9:16)')
      artStyle,
    } = req.body;

    debug('INPUT', { storyType, voice, language, durationSec, aspectRatio, artStyle });

    // Normalize aspect 'Vertical (9:16)' -> '9:16'
    const aspect = String(aspectRatio || '').replace(/[^\d:]/g, ''); // keep only digits and colon

    // Map aspect to template IDs from env
    const MAP = {
      '9:16': process.env.CREATOMATE_TPL_916 || '',
      '1:1' : process.env.CREATOMATE_TPL_11  || '',
      '16:9': process.env.CREATOMATE_TPL_169 || '',
    };

    const envStatus = {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      has916: !!MAP['9:16'],
      has11:  !!MAP['1:1'],
      has169: !!MAP['16:9'],
    };
    debug('ENV_STATUS', envStatus);

    if (!envStatus.hasApiKey) {
      return res.status(400).json({ error: 'MISSING_ENV', detail: 'CREATOMATE_API_KEY not set' });
    }

    if (!aspect) {
      return res.status(400).json({ error: 'MISSING_ASPECT', detail: { aspectRatio } });
    }

    const templateId = MAP[aspect];
    if (!templateId) {
      return res.status(400).json({
        error: 'NO_TEMPLATE_FOR_ASPECT',
        detail: {
          aspectReceived: aspectRatio,
          aspectNormalized: aspect,
          haveTemplatesFor: Object.entries(MAP).filter(([,v]) => !!v).map(([k]) => k),
        },
      });
    }

    // Build Creatomate payload (make sure keys match your template layer names)
    const payload = {
      template_id: templateId,
      modifications: {
        Headline: (customPrompt && customPrompt.trim()) ? customPrompt.trim() : 'Sample Headline',
        image_url: 'https://picsum.photos/1080/1920',
        voice_url: null, // set later when you add TTS
      },
    };

    debug('CALLING_CREATOMATE', { templateId, aspect, payloadPreview: { ...payload, modifications: { ...payload.modifications, image_url: '[omitted]' } } });

    const r = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CREATOMATE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json().catch(() => ({}));
    debug('CREATOMATE_RESPONSE_META', { status: r.status, ok: r.ok });
    if (!r.ok) {
      // Surface Creatomate’s message so we can see exactly why it failed
      debug('CREATOMATE_ERROR_BODY', json);
      return res.status(502).json({ error: 'CREATOMATE_CREATE_FAILED', status: r.status, body: json });
    }

    if (!json?.id) {
      debug('NO_JOB_ID_IN_RESPONSE', json);
      return res.status(502).json({ error: 'NO_JOB_ID_IN_RESPONSE', body: json });
    }

    debug('SUCCESS_JOB', { job_id: json.id });
    return res.status(200).json({ job_id: json.id });
  } catch (err) {
    console.error('[CREATE_VIDEO_ERROR]', err);
    return res.status(500).json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
