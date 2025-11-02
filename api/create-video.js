// api/create-video.js  (CommonJS)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const { hostname, pathname } = new URL(url);
    const data = JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST', // force HTTP/1.1
        headers: {
          'Authorization': headers.Authorization,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); }
          catch { resolve({ status: res.statusCode, json: { raw: buf } }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const {
      storyType   = 'Motivational',
      artStyle    = 'Realistic',
      language    = 'English',
      voice       = 'Adam',
      aspectRatio = '9:16',
      // optional overrides
      perBeatSec  = 10, // ~10–12 sec per beat is comfy
      voice_url   = null, // if you generate TTS elsewhere, pass it here
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Pick template ID by aspect ratio (you already have these envs set)
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1' : process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();
    if (!template_id) {
      return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // 1) Ask our script endpoint for narration + beats
    const scriptResp = await fetch(`${process.env.PUBLIC_BASE_URL || ''}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyType, artStyle, language, targetBeats: 6 }),
    }).then(r => r.json());

    if (!scriptResp?.beats?.length || !scriptResp?.narration) {
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    const beats = scriptResp.beats.slice(0, 10); // cap to number of scenes you built
    const narration = scriptResp.narration;

    // 2) Map beats -> template selectors
    // Your template must have Scene1_*, Scene2_*, … selectors as noted above.
    const mods = {
      Narration: narration, // your hidden text layer for TTS / reference

      // Optional voice URL if your template has an audio layer with selector "voice_url"
      ...(voice_url ? { voice_url } : {}),
    };

    beats.forEach((b, i) => {
      const idx = i + 1;
      mods[`Scene${idx}_Text`]    = b.caption;
      // For now, use an AI/stock image endpoint; swap with your own generator or CDN
      // You can pipe b.imagePrompt into your image generator; as a placeholder use picsum with a seed
      mods[`Scene${idx}_Image`]   = `https://picsum.photos/seed/${encodeURIComponent(b.imagePrompt || idx)}/1080/1920`;
      mods[`Scene${idx}_Visible`] = true;
    });

    // Hide any unused scenes (e.g., if you made 10 slots but got 6 beats)
    for (let i = beats.length + 1; i <= 10; i++) {
      mods[`Scene${i}_Visible`] = false;
    }

    // 3) Compute total duration from beats (or omit if your template defines it internally)
    const duration = Math.max(5, Math.round(beats.length * perBeatSec));

    // 4) Fire Creatomate with the *single-object* payload (this is the shape that produced MP4 for you)
    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
      duration, // comment this out if your template’s timeline is fully self-determined
    };

    const resp = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    if (resp.status !== 202) {
      console.error('[CREATOMATE_ERROR]', resp.status, resp.json);
      return res.status(resp.status).json({ error: 'CREATOMATE_ERROR', details: resp.json });
    }

    const job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
    if (!job_id) return res.status(502).json({ error: 'NO_JOB_ID_IN_RESPONSE', details: resp.json });

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO] SERVER_ERROR', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
};
