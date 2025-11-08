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
        path: pathname,
        method: 'POST', // force HTTP/1.1
        headers: {
          Authorization: headers.Authorization,
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
      perBeatSec  = 10,      // fallback if generate-script doesn’t return durations
      voice_url   = null,    // pass TTS url here if you have one
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Map aspect ratio -> your template IDs
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1' : process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();
    if (!template_id) {
      return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // 1) Get narration + beats
    const scriptURL = `${process.env.PUBLIC_BASE_URL || ''}/api/generate-script`;
    const scriptResp = await fetch(scriptURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyType, artStyle, language,
        targetBeats: 6,
      }),
    }).then(r => r.json()).catch(() => null);

    if (!scriptResp?.beats?.length || !scriptResp?.narration) {
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // Normalize beats -> ensure start/duration exist and are cumulative
    const beatsIn = scriptResp.beats.slice(0, 10); // limit to number of scenes built
    const beats = [];
    let cursor = 0;
    for (const b of beatsIn) {
      const dur = Math.max(1, Math.round(b.duration || perBeatSec));
      const start = (typeof b.start === 'number' ? b.start : cursor);
      beats.push({
        start,
        duration: dur,
        caption: b.caption || '',
        imagePrompt: b.imagePrompt || '',        // optional from your script endpoint
        image: b.image || null,                  // if you already resolved an image URL
      });
      cursor = start + dur;
    }

    // 2) Build property-level modifications matching your template selectors:
    //   Beat{n}_Image     -> time.start, time.duration, source
    //   Beat{n}_Caption   -> time.start, time.duration, text
    //   Narration         -> text
    //   Voiceover         -> source   (optional)
    const modifications = [];

    // Narration text
    modifications.push({
      selector: 'Narration',
      property: 'text',
      value: scriptResp.narration,
    });

    // Optional TTS audio
    if (voice_url) {
      modifications.push({
        selector: 'Voiceover',
        property: 'source',
        value: voice_url,
      });
    }

    // Per-beat image + caption timings + content
    beats.forEach((b, i) => {
      const n = i + 1;

      // Image timing + source
      modifications.push(
        { selector: `Beat${n}_Image`, property: 'time.start',    value: b.start },
        { selector: `Beat${n}_Image`, property: 'time.duration', value: b.duration },
        { selector: `Beat${n}_Image`, property: 'source',        value: b.image || `https://picsum.photos/seed/${encodeURIComponent(b.imagePrompt || `beat-${n}`)}/1080/1920` },
      );

      // Caption timing + text
      modifications.push(
        { selector: `Beat${n}_Caption`, property: 'time.start',    value: b.start },
        { selector: `Beat${n}_Caption`, property: 'time.duration', value: b.duration },
        { selector: `Beat${n}_Caption`, property: 'text',          value: b.caption || '' },
      );
    });

    // 3) Send Creatomate request — use ARRAY payload (this is the shape that returned MP4 for you)
    const payload = [{
      template_id,
      output_format: 'mp4',
      modifications,
      // Do NOT set global duration here; individual layer durations control the timeline.
      // If your template needs a hard cap, you can add: duration: beats.at(-1).start + beats.at(-1).duration
    }];

    // Preview log (safe)
    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', JSON.stringify({
      item_count: payload.length,
      first_item: {
        template_id: template_id?.slice(0, 8) + '…',
        mods: modifications.length,
        first_mod: modifications[0],
      },
    }));

    const resp = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    console.log('[CREATE_VIDEO] RESP', resp.status, typeof resp.json === 'object' ? JSON.stringify(resp.json).slice(0, 300) : resp.json);

    if (resp.status !== 202) {
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
