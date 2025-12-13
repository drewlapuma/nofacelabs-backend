// api/create-video.js (Node 18, CommonJS)

const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = 'krea';

const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_STYLE_ID = 'tvjlqsab9'; // Creepy Toon
const KREA_GENERATE_URL =
  'https://api.krea.ai/generate/image/bfl/flux-1-dev';

const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT = 3;

const ANIMATION_VARIANTS = [
  'PanRight',
  'PanLeft',
  'PanUp',
  'PanDown',
  'Zoom',
];

// ---------------- CORS ----------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ---------------- HTTPS JSON helper ----------------
function postJSON(url, headers, body) {
  return new Promise((resolve, reject) => {
    const { hostname, pathname } = new URL(url);
    const data = JSON.stringify(body);

    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        headers: {
          ...headers,
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

// ---------------- Timing helpers ----------------
function estimateSpeechSeconds(text) {
  const words = (text.match(/\S+/g) || []).length;
  return words / 2.5;
}

function splitNarrationIntoBeats(narration, beatCount) {
  const words = narration.split(/\s+/);
  const chunk = Math.ceil(words.length / beatCount);

  const beats = [];
  for (let i = 0; i < words.length; i += chunk) {
    beats.push(words.slice(i, i + chunk).join(' '));
  }

  while (beats.length < beatCount) {
    beats.push(beats[beats.length - 1]);
  }

  return beats.slice(0, beatCount);
}

// ---------------- Prompt (NO STYLE) ----------------
function buildScenePrompt({ beatText, index }) {
  return `
Scene ${index} from a narrated scary story.

Story narration:
"${beatText}"

Single illustrated scene. No text in image.
`.trim();
}

// ---------------- Krea generation ----------------
async function createKreaJob(prompt, aspectRatio) {
  const r = await fetch(KREA_GENERATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspectRatio,
      styles: [
        {
          id: KREA_STYLE_ID,
          strength: 0.85,
        },
      ],
    }),
  });

  const data = await r.json();

  if (!r.ok || !data.job_id) {
    console.error('[KREA_GENERATE_ERROR]', data);
    throw new Error('KREA_GENERATE_FAILED');
  }

  return data.job_id;
}

async function pollKreaJob(jobId) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));

    const r = await fetch(`https://api.krea.ai/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${KREA_API_KEY}`,
      },
    });

    const data = await r.json();

    if (data.status === 'completed' && data?.result?.urls?.[0]) {
      return data.result.urls[0];
    }

    if (data.status === 'failed') {
      throw new Error('KREA_JOB_FAILED');
    }
  }

  throw new Error('KREA_JOB_TIMEOUT');
}

// ---------------- Animations ----------------
function buildVariantSequence(count) {
  const out = [];
  let last = null;

  for (let i = 0; i < count; i++) {
    const options = ANIMATION_VARIANTS.filter((v) => v !== last);
    const v = options[i % options.length];
    out.push(v);
    last = v;
  }
  return out;
}

// ---------------- MAIN HANDLER ----------------
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      storyType,
      artStyle,
      language,
      aspectRatio = '9:16',
      durationRange = '60-90',
      customPrompt = '',
    } = body;

    // ---- Generate script ----
    const baseUrl = `https://${req.headers.host}`;
    const scriptResp = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyType,
        artStyle,
        language,
        customPrompt,
        durationRange,
      }),
    }).then((r) => r.json());

    const narration = scriptResp?.narration;
    if (!narration) throw new Error('SCRIPT_EMPTY');

    // ---- Beats ----
    const speechSec = estimateSpeechSeconds(narration);
    let beatCount = Math.round(speechSec / SECONDS_PER_BEAT);
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // ---- Images ----
    const imageUrls = [];
    for (let i = 0; i < beatCount; i++) {
      const prompt = buildScenePrompt({
        beatText: beatTexts[i],
        index: i + 1,
      });

      const jobId = await createKreaJob(prompt, aspectRatio);
      const url = await pollKreaJob(jobId);
      imageUrls.push(url);
    }

    // ---- Animations ----
    const variants = buildVariantSequence(beatCount);

    // ---- Creatomate mods ----
    const mods = {
      'Voiceover.text': narration, // 🔊 ONLY voice source
    };

    for (let i = 1; i <= beatCount; i++) {
      for (const v of ANIMATION_VARIANTS) {
        const key = `Beat${i}_${v}_Image`;
        mods[key] =
          v === variants[i - 1] ? imageUrls[i - 1] : null;
      }
    }

    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      for (const v of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${v}_Image`] = null;
      }
    }

    // ---- Render ----
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };

    const template_id = templateMap[aspectRatio];

    const render = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      {
        template_id,
        modifications: mods,
        output_format: 'mp4',
      }
    );

    const job_id = render.json?.id || render.json?.[0]?.id;
    if (!job_id) throw new Error('CREATOMATE_NO_JOB');

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO_ERROR]', err);
    return res.status(500).json({
      error: 'SERVER_ERROR',
      message: String(err.message || err),
    });
  }
};
