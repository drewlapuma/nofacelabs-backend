// api/create-video.js  (CommonJS on Vercel)

const CORS_ORIGIN = process.env.ALLOW_ORIGIN || '*';

function sendCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  sendCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // --- parse body safely (Webflow often sends a string) ---
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    console.log('[CREATE_VIDEO] INPUT', body);

    // --- normalize aspect and resolve template id from env ---
    const rawAspect = (body.aspectRatio ?? '').toString().trim(); // e.g. '9:16'
    const aspect = rawAspect.replace(/\s/g, '');                   // remove spaces

    const TPL_916 = process.env.CREATO_TEMPLATE_916; // vertical
    const TPL_11  = process.env.CREATO_TEMPLATE_11;  // square
    const TPL_169 = process.env.CREATO_TEMPLATE_169; // horizontal

    console.log('[CREATE_VIDEO] ENV_STATUS', {
      hasApiKey: !!process.env.CREATOMATE_API_KEY,
      aspect,
      rawAspect,
      env916: TPL_916 ? `${TPL_916.slice(0, 6)}…` : null,
      env11:  TPL_11  ? `${TPL_11.slice(0, 6)}…`  : null,
      env169: TPL_169 ? `${TPL_169.slice(0, 6)}…` : null,
    });

    const MAP = { '9:16': TPL_916, '1:1': TPL_11, '16:9': TPL_169 };
    const templateId = MAP[aspect];

    if (!templateId) {
      console.error('[CREATE_VIDEO] NO_TEMPLATE_FOR_ASPECT', {
        aspect,
        missing: { '9:16': !TPL_916, '1:1': !TPL_11, '16:9': !TPL_169 }
      });
      return res.status(400).json({
        ok: false,
        code: 'NO_TEMPLATE_FOR_ASPECT',
        aspect,
      });
    }

    // --- build Creatomate payload ---
    const payload = {
      template_id: templateId,
      modifications: {
        Headline:  body.headline  || 'Sample Headline',
        image_url: body.imageUrl  || 'https://picsum.photos/1080/1920',
        voice_url: body.voiceUrl  || null,
      },
    };

    console.log('[CREATE_VIDEO] CALL_PAYLOAD', {
      aspect,
      templateId: `${templateId.slice(0, 6)}…`,
    });

    // --- call Creatomate (CJS-friendly dynamic import) ---
    const fetch = (...args) =>
      import('node-fetch').then(({ default: f }) => f(...args));

    const resp = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    console.log('[CREATE_VIDEO] CREATOMATE_RESPONSE', data);

    const jobId =
      data?.renders?.[0]?.id ||
      data?.id ||
      data?.render_id ||
      data?.job_id;

    if (!jobId) {
      console.error('[CREATE_VIDEO] CREATOMATE_BAD_RESPONSE');
      return res.status(502).json({
        ok: false,
        code: 'CREATOMATE_BAD_RESPONSE',
        data,
      });
    }

    return res.status(200).json({ ok: true, job_id: jobId });
  } catch (err) {
    console.error('[CREATE_VIDEO] ERROR', err);
    return res.status(500).json({
      ok: false,
      code: 'INTERNAL',
      message: String(err?.message || err),
    });
  }
};
