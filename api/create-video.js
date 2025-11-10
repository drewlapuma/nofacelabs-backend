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
        method: 'POST', // HTTP/1.1
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
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') });
          } catch {
            resolve({ status: res.statusCode, json: { raw: buf } });
          }
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const {
      storyType   = 'Motivational',
      artStyle    = 'Scary toon',  // will be overridden by Webflow choice
      language    = 'English',
      voice       = 'Adam',
      aspectRatio = '9:16',
      perBeatSec  = 10,
      voice_url   = null,          // if you later pass a TTS URL
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1' : process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();

    if (!template_id) {
      return res
        .status(400)
        .json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // ---- 1) Call /api/generate-script on THIS backend ----
    const baseUrl   = `https://${req.headers.host}`;
    const scriptUrl = `${baseUrl}/api/generate-script`;

    const scriptResp = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyType,
        artStyle,
        language,
        targetBeats: 6, // how many beats you *want* (max)
      }),
    }).then((r) => r.json());

    console.log('[CREATE_VIDEO] SCRIPT_RESP preview', {
      hasBeats: !!scriptResp?.beats?.length,
      hasNarration: !!scriptResp?.narration,
    });

    if (!scriptResp?.beats?.length || !scriptResp?.narration) {
      console.error('[CREATE_VIDEO] SCRIPT_EMPTY', scriptResp);
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // ---- 2) Build modifications USING YOUR ACTUAL SELECTORS ----
    const maxScenes  = 6;                         // you built 6 beats in the template
    const beats      = scriptResp.beats.slice(0, maxScenes);
    const narration  = scriptResp.narration;

    // Text layer named "Narration" and an audio layer using selector "Voiceover"
    const mods = {
      Narration: narration,
      Voiceover: narration,          // so the Voiceover audio layer can read it
      ...(voice_url ? { voice_url } : {}),
    };

    // Beat1_Caption / Beat1_Image / Beat1_Visible etc.
    beats.forEach((b, i) => {
      const idx = i + 1;

      // On-screen caption
      mods[`Beat${idx}_Caption`] = b.caption;

      // Strong prompt for your DALL-E/OpenAI image layer
      const pieces = [];
      if (b.imagePrompt) pieces.push(b.imagePrompt);
      pieces.push(`${artStyle} style illustration`);
      pieces.push('vertical 9:16, no text overlay, high quality');

      mods[`Beat${idx}_Image`]   = pieces.join(', ');
      mods[`Beat${idx}_Visible`] = true; // if you added a visibility selector
    });

    // Hide any unused scenes (if template has Beat*_Visible toggles)
    for (let i = beats.length + 1; i <= maxScenes; i++) {
      mods[`Beat${i}_Visible`] = false;
    }

    // Duration based on number of beats (~perBeatSec each)
    const duration = Math.max(5, Math.round(beats.length * perBeatSec));

    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
      duration,
    };

    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', {
      template_id_preview: template_id.slice(0, 6) + '…',
      duration,
      beatCount: beats.length,
    });

    // ---- 3) Call Creatomate ----
    const resp = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    console.log('[CREATE_VIDEO] CREATOMATE_RESP_STATUS', resp.status);

    if (resp.status !== 202) {
      console.error('[CREATOMATE_ERROR]', resp.status, resp.json);
      return res
        .status(resp.status)
        .json({ error: 'CREATOMATE_ERROR', details: resp.json });
    }

    const job_id = Array.isArray(resp.json)
      ? resp.json[0]?.id
      : resp.json?.id;

    if (!job_id) {
      console.error('[CREATE_VIDEO] NO_JOB_ID_IN_RESPONSE', resp.json);
      return res
        .status(502)
        .json({ error: 'NO_JOB_ID_IN_RESPONSE', details: resp.json });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO] SERVER_ERROR', err);
    return res
      .status(500)
      .json({ error: 'SERVER_ERROR', message: String(err?.message || err) });
  }
};
