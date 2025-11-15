// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Simple HTTPS JSON helper (avoids HTTP/2 weirdness)
function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const { hostname, pathname } = new URL(url);
    const data = JSON.stringify(bodyObj);

    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        headers: {
          Authorization: headers.Authorization,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (buf += chunk));
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

// Rough speech timing helper → how many beats we need for this narration
function estimateBeatsFromNarration(narration, minBeats, maxBeats) {
  const text = (narration || '').trim();
  if (!text) return minBeats;

  const chars = text.length;
  const charsPerBeat = 180; // ~4–6 seconds spoken
  let est = Math.round(chars / charsPerBeat);
  if (!est || !Number.isFinite(est)) est = minBeats;

  return Math.max(minBeats, Math.min(maxBeats, est));
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
      storyType      = 'Random AI story',
      artStyle       = 'Realistic',
      language       = 'English',
      voice          = 'Adam',
      aspectRatio    = '9:16',
      customPrompt   = '',
      durationRange  = '60-90', // "30-60" or "60-90" from your dropdown
      // tuning knobs:
      perBeatSec     = 4,       // ~4 seconds per scene
      voice_url      = null,    // if you eventually plug ElevenLabs in
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Map the dropdown choice → min / max duration in seconds
    let minDurationSec = 60;
    let maxDurationSec = 90;

    if (durationRange === '30-60') {
      minDurationSec = 30;
      maxDurationSec = 60;
    } else if (durationRange === '60-90') {
      minDurationSec = 60;
      maxDurationSec = 90;
    }

    // Pick template ID by aspect ratio
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

    // 1) Call /api/generate-script on THIS backend to get narration
    const baseUrl   = `https://${req.headers.host}`;
    const scriptUrl = `${baseUrl}/api/generate-script`;

    const scriptResp = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyType,
        artStyle,
        language,
        customPrompt,
        minDurationSec,
        maxDurationSec,
      }),
    }).then((r) => r.json());

    console.log('[CREATE_VIDEO] SCRIPT_RESP preview', {
      hasNarration: !!scriptResp?.narration,
      storyType,
      artStyle,
      minDurationSec,
      maxDurationSec,
    });

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      console.error('[CREATE_VIDEO] SCRIPT_EMPTY', scriptResp);
      return res
        .status(502)
        .json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // 2) Decide how many beats we need based on narration length
    const MIN_BEATS = 6;
    const MAX_BEATS = 18; // increase if your template has more Beat slots
    const beatCount = estimateBeatsFromNarration(
      narration,
      MIN_BEATS,
      MAX_BEATS
    );

    // 3) Build modifications USING your selectors:
    //    - Narration (full script)
    //    - Voiceover (same text, for your TTS layer)
    //    - Beat1_Image, Beat1_Caption, Beat1_Visible, ... up to beatCount
    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      ...(voice_url ? { voice_url } : {}),
    };

    const style = artStyle || 'Realistic';

    for (let i = 1; i <= beatCount; i++) {
      const sceneTitle = `Scene ${i}`;
      const imgPrompt = `${style} style illustration of scene ${i} from this story: ${narration}. ${style} style, vertical 9:16, no text overlay, high quality`;

      mods[`Beat${i}_Caption`] = sceneTitle;
      mods[`Beat${i}_Image`]   = imgPrompt;
      mods[`Beat${i}_Visible`] = true;
    }

    // Hide any extra beats in the template above beatCount (up to MAX_BEATS)
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Visible`] = false;
    }

    // 4) Estimate video duration from beatCount, then clamp it to the chosen range
    let durationEst = Math.round(beatCount * perBeatSec);
    if (!Number.isFinite(durationEst) || durationEst <= 0) {
      durationEst = Math.round((minDurationSec + maxDurationSec) / 2);
    }

    const duration = Math.max(minDurationSec, Math.min(maxDurationSec, durationEst));

    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
      duration,
    };

    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', {
      template_id_preview: template_id.slice(0, 6) + '…',
      duration,
      beatCount,
    });

    // 5) Call Creatomate
    const resp = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    console.log('[CREATE_VIDEO] CREATOMATE_RESP_STATUS', resp.status);

    if (resp.status !== 202 && resp.status !== 200) {
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
