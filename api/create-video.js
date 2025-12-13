// api/create-video.js (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = 'krea';

// Krea config
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL =
  'https://api.krea.ai/generate/image/bfl/flux-1-dev';

// Creatomate config
const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;

// Beats / timing
const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT = 3.0;

// Creepy Toon style ID (locked)
const KREA_STYLE_ID = 'tvjlqsab9';

// Animation variants (template layers must exist)
const ANIMATION_VARIANTS = [
  'PanRight',
  'PanLeft',
  'PanUp',
  'PanDown',
  'Zoom',
];

// ----------------- CORS -----------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ----------------- Creatomate helper -----------------
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
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, json: {} });
          }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ----------------- Helpers -----------------
function estimateSpeechSeconds(text) {
  const words = (text.match(/\S+/g) || []).length;
  return words / 2.5;
}

function splitNarrationIntoBeats(text, beatCount) {
  const words = text.split(/\s+/);
  const chunkSize = Math.ceil(words.length / beatCount);
  const beats = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    beats.push(words.slice(i, i + chunkSize).join(' '));
  }

  while (beats.length < beatCount) {
    beats.push(beats[beats.length - 1]);
  }

  return beats.slice(0, beatCount);
}

function buildVariantSequence(count) {
  const seq = [];
  let last = null;

  for (let i = 0; i < count; i++) {
    const available = ANIMATION_VARIANTS.filter((v) => v !== last);
    const chosen = available[i % available.length];
    seq.push(chosen);
    last = chosen;
  }

  return seq;
}

// ----------------- Krea image generation -----------------
async function generateKreaImage(prompt, aspectRatio) {
  const resp = await fetch(KREA_GENERATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      style_id: KREA_STYLE_ID,
      aspect_ratio: aspectRatio,
    }),
  });

  const data = await resp.json();

  if (!resp.ok || !data?.job_id) {
    console.error('[KREA_ERROR]', resp.status, data);
    throw new Error('KREA_GENERATION_FAILED');
  }

  return data.job_id;
}

async function pollKreaJob(jobId) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const r = await fetch(`https://api.krea.ai/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${KREA_API_KEY}`,
      },
    });

    const data = await r.json();

    if (data.status === 'completed') {
      return data.result?.urls?.[0] || null;
    }
  }

  throw new Error('KREA_TIMEOUT');
}

// ----------------- MAIN HANDLER -----------------
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      storyType,
      language,
      aspectRatio = '9:16',
      durationRange = '60-90',
      customPrompt = '',
    } = body;

    // 1) Get narration
    const baseUrl = `https://${req.headers.host}`;
    const scriptResp = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyType,
        language,
        durationRange,
        customPrompt,
      }),
    }).then((r) => r.json());

    const narration = scriptResp?.narration?.trim();
    if (!narration) throw new Error('SCRIPT_EMPTY');

    // 2) Beats
    const speechSec = estimateSpeechSeconds(narration);
    const targetSec =
      durationRange === '30-60'
        ? Math.min(Math.max(speechSec, 30), 60)
        : Math.min(Math.max(speechSec, 60), 90);

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT);
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);
    const variants = buildVariantSequence(beatCount);

    // 3) Generate images
    const imageUrls = [];
    for (let i = 0; i < beatCount; i++) {
      const scenePrompt = `Illustration of this scene:\n${beatTexts[i]}`;
      const jobId = await generateKreaImage(scenePrompt, aspectRatio);
      const url = await pollKreaJob(jobId);
      imageUrls.push(url);
    }

    // 4) Build Creatomate mods (NO VOICE CHANGES)
    const mods = {
      Narration: narration,
      StoryTypeLabel: storyType,
      LanguageLabel: language,
    };

    for (let i = 1; i <= beatCount; i++) {
      for (const v of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${v}_Image`] =
          v === variants[i - 1] ? imageUrls[i - 1] : null;
      }
    }

    // Clear unused beats
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      for (const v of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${v}_Image`] = null;
      }
    }

    // 5) Render video
    const template_id =
      aspectRatio === '1:1'
        ? process.env.CREATO_TEMPLATE_11
        : aspectRatio === '16:9'
        ? process.env.CREATO_TEMPLATE_169
        : process.env.CREATO_TEMPLATE_916;

    const render = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
      { template_id, modifications: mods, output_format: 'mp4' }
    );

    const job_id = render?.json?.[0]?.id || render?.json?.id;
    if (!job_id) throw new Error('CREATOMATE_FAILED');

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO_ERROR]', err);
    return res
      .status(500)
      .json({ error: 'SERVER_ERROR', message: err.message });
  }
};
