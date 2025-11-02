// api/create-video.js  (CommonJS on Vercel)
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
        path: pathname,            // POST /v1/renders
        method: 'POST',            // forces HTTP/1.1
        headers: {
          'Authorization': headers.Authorization,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
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
      storyType,
      customPrompt,
      durationSec = 75,
      aspectRatio = '9:16'
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Pick template by aspect
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1' : process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();

    if (!template_id) {
      return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // Build modifications
    const modifications = {
      Headline: (customPrompt && customPrompt.trim()) ? customPrompt.trim() : (storyType || 'Sample Headline'),
      image_url: 'https://picsum.photos/1080/1920'
    };

    // *** This is the shape that returned MP4 for you (shape #2) ***
    const payload = {
      template_id,
      modifications,
      output_format: 'mp4',
      duration: Math.max(1, Number(durationSec))  // e.g., 60–90 from your UI
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
    if (!job_id) {
      return res.status(502).json({ error: 'NO_JOB_ID_IN_RESPONSE', details: resp.json });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO] SERVER_ERROR', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
};
