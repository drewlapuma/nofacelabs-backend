// api/create-video.js (CommonJS, Node 18)

const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = 'krea';

const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL = 'https://api.krea.ai/generate/image/bfl/flux-1-dev';
const KREA_JOB_URL_BASE = 'https://api.krea.ai/jobs';

const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT = 3;

const ANIMATION_VARIANTS = ['PanRight', 'PanLeft', 'PanUp', 'PanDown', 'Zoom'];

// 🔑 your creepy toon style id
const DEFAULT_KREA_STYLE_ID = 'tvjlqsab9';

/* ---------------- CORS ---------------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ---------------- helpers ---------------- */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function estimateSpeechSeconds(text) {
  const words = (text.match(/\S+/g) || []).length;
  return words / 2.5;
}

function splitNarrationIntoBeats(narration, beatCount) {
  const words = narration.split(/\s+/);
  const chunkSize = Math.ceil(words.length / beatCount);
  const beats = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    beats.push(words.slice(i, i + chunkSize).join(' '));
  }

  while (beats.length < beatCount) beats.push(beats[beats.length - 1]);
  return beats.slice(0, beatCount);
}

/* ---------------- KREA ---------------- */
async function kreaFetch(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, json };
}

async function generateKreaImage(prompt, aspectRatio) {
  const { ok, json, status } = await kreaFetch(KREA_GENERATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      style_id: DEFAULT_KREA_STYLE_ID,
      aspect_ratio: aspectRatio,
    }),
  });

  if (!ok || !json.job_id) {
    console.error('[KREA_GENERATE_ERROR]', status, json);
    throw new Error('KREA_GENERATE_FAILED');
  }

  const jobId = json.job_id;

  // poll job
  for (let i = 0; i < 40; i++) {
    await sleep(2500);

    const r = await kreaFetch(`${KREA_JOB_URL_BASE}/${jobId}`, {
      headers: { Authorization: `Bearer ${KREA_API_KEY}` },
    });

    if (!r.ok) continue;

    if (r.json.status === 'completed') {
      const url = r.json?.result?.urls?.[0];
      if (!url) throw new Error('KREA_NO_IMAGE_URL');
      return url;
    }

    if (r.json.status === 'failed') {
      throw new Error('KREA_JOB_FAILED');
    }
  }

  throw new Error('KREA_TIMEOUT');
}

async function generateImagesForBeats(beats, aspectRatio) {
  const urls = [];

  for (let i = 0; i < beats.length; i++) {
    try {
      console.log(`[KREA] Beat ${i + 1}/${beats.length}`);
      const url = await generateKreaImage(beats[i], aspectRatio);
      urls.push(url);
    } catch (e) {
      console.error('[KREA] Beat failed', e.message);
      urls.push(null);
    }
  }

  return urls;
}

/* ---------------- Creatomate ---------------- */
function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const { hostname, pathname } = new URL(url);

    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      res => {
        let buf = '';
        res.on('data', d => (buf += d));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
          catch { resolve({ status: res.statusCode, json: {} }); }
        });
      }
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* ---------------- handler ---------------- */
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      storyType,
      artStyle,
      language,
      aspectRatio = '9:16',
      durationRange = '60-90',
    } = body;

    const baseUrl = `https://${req.headers.host}`;

    // 1. generate script
    const scriptRes = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyType, artStyle, language, durationRange }),
    });

    const script = await scriptRes.json();
    const narration = script.narration;

    const speechSec = estimateSpeechSeconds(narration);
    const beatCount = Math.max(
      MIN_BEATS,
      Math.min(MAX_BEATS, Math.round(speechSec / SECONDS_PER_BEAT))
    );

    const beats = splitNarrationIntoBeats(narration, beatCount);

    // 2. images
    const imageUrls = await generateImagesForBeats(beats, aspectRatio);

    // 3. animations
    const variants = [];
    let last = null;
    for (let i = 0; i < beatCount; i++) {
      const options = ANIMATION_VARIANTS.filter(v => v !== last);
      const chosen = options[i % options.length];
      variants.push(chosen);
      last = chosen;
    }

    // 4. build mods
    const mods = { Narration: narration };

    for (let i = 1; i <= MAX_BEATS; i++) {
      for (const v of ANIMATION_VARIANTS) {
        const key = `Beat${i}_${v}_Image`;
        mods[key] =
          i <= beatCount && v === variants[i - 1]
            ? imageUrls[i - 1]
            : null;
      }
    }

    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };

    const payload = {
      template_id: templateMap[aspectRatio],
      modifications: mods,
      output_format: 'mp4',
    };

    const r = await postJSON('https://api.creatomate.com/v1/renders', payload);

    if (![200, 202].includes(r.status)) {
      return res.status(500).json({ error: 'CREATOMATE_FAILED', r });
    }

    const job_id = Array.isArray(r.json) ? r.json[0]?.id : r.json?.id;

    return res.json({ ok: true, job_id });
  } catch (e) {
    console.error('[CREATE_VIDEO_ERROR]', e);
    res.status(500).json({ error: e.message });
  }
};
