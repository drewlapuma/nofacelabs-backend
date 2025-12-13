// api/create-video.js  (CommonJS, Node 18)

const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = 'krea';

// --- KREA CONFIG ---
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL = 'https://api.krea.ai/generate/image/bfl/flux-1-dev';
const KREA_JOB_URL = 'https://api.krea.ai/jobs';
const KREA_STYLE_ID = 'tvjlqsab9'; // Creepy Toon style

// --- TIMING ---
const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT = 3;

// --- ANIMATIONS ---
const ANIMATION_VARIANTS = ['PanRight', 'PanLeft', 'PanUp', 'PanDown', 'Zoom'];

// ----------------- CORS -----------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ----------------- Helpers -----------------
function estimateSpeechSeconds(text) {
  const words = (text.match(/\S+/g) || []).length;
  return words / 2.5;
}

function splitNarrationIntoBeats(narration, beatCount) {
  const words = narration.split(/\s+/);
  const size = Math.ceil(words.length / beatCount);
  const beats = [];
  for (let i = 0; i < words.length; i += size) {
    beats.push(words.slice(i, i + size).join(' '));
  }
  while (beats.length < beatCount) beats.push(beats[beats.length - 1]);
  return beats.slice(0, beatCount);
}

function buildVariantSequence(count) {
  const seq = [];
  let last = null;
  for (let i = 0; i < count; i++) {
    const opts = ANIMATION_VARIANTS.filter(v => v !== last);
    const v = opts[i % opts.length];
    seq.push(v);
    last = v;
  }
  return seq;
}

// ----------------- KREA IMAGE GENERATION -----------------
async function createKreaJob(prompt, aspectRatio) {
  const resp = await fetch(KREA_GENERATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt,
      style_id: KREA_STYLE_ID,
      aspect_ratio: aspectRatio
    })
  });

  const data = await resp.json();
  if (!resp.ok || !data.job_id) {
    console.error('[KREA_CREATE_ERROR]', data);
    throw new Error('KREA_CREATE_FAILED');
  }
  return data.job_id;
}

async function pollKreaJob(jobId) {
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${KREA_JOB_URL}/${jobId}`, {
      headers: { Authorization: `Bearer ${KREA_API_KEY}` }
    });
    const j = await r.json();
    if (j.status === 'completed' && j.result?.urls?.[0]) {
      return j.result.urls[0];
    }
    if (j.status === 'failed') throw new Error('KREA_JOB_FAILED');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('KREA_TIMEOUT');
}

async function generateKreaImages({ beatTexts, aspectRatio }) {
  const urls = [];
  for (let i = 0; i < beatTexts.length; i++) {
    const visualPrompt = `
Illustration of this scene from a creepy story:
${beatTexts[i]}

Describe what is visible in the scene, the environment, lighting, and mood.
Single scene illustration.
`.trim();

    console.log(`🖼️ KREA PROMPT BEAT ${i + 1}:\n`, visualPrompt);

    const jobId = await createKreaJob(visualPrompt, aspectRatio);
    const imageUrl = await pollKreaJob(jobId);
    urls.push(imageUrl);
  }
  return urls;
}

// ----------------- VOICE + CAPTIONS -----------------
async function getVoiceAndCaptions(baseUrl, narration, language) {
  const r = await fetch(`${baseUrl}/api/voice-captions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narration, language })
  });
  const d = await r.json();
  if (!r.ok || !d.ok) throw new Error('VOICE_CAPTIONS_FAILED');
  return d;
}

// ----------------- CREATOMATE -----------------
function postJSON(url, auth, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const { hostname, pathname } = new URL(url);

    const req = https.request(
      {
        hostname,
        path: pathname,
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      res => {
        let buf = '';
        res.on('data', c => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(buf) }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ----------------- MAIN HANDLER -----------------
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    const {
      storyType,
      language,
      aspectRatio,
      customPrompt,
      durationRange
    } = body;

    const baseUrl = `https://${req.headers.host}`;

    // 1️⃣ Script
    const scriptResp = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyType, language, customPrompt, durationRange })
    }).then(r => r.json());

    const narration = scriptResp.narration;
    if (!narration) throw new Error('NO_SCRIPT');

    // 2️⃣ Voice + captions
    const { voiceUrl, captions } =
      await getVoiceAndCaptions(baseUrl, narration, language);

    // 3️⃣ Beats
    const speechSec = estimateSpeechSeconds(narration);
    const beatCount = Math.min(
      MAX_BEATS,
      Math.max(MIN_BEATS, Math.round(speechSec / SECONDS_PER_BEAT))
    );
    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 4️⃣ Images
    const imageUrls = await generateKreaImages({ beatTexts, aspectRatio });

    // 5️⃣ Animations
    const variants = buildVariantSequence(beatCount);

    // 6️⃣ Creatomate mods
    const mods = {
      VoiceUrl: voiceUrl,
      'Captions_JSON.text': JSON.stringify(captions)
    };

    for (let i = 1; i <= beatCount; i++) {
      for (const v of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${v}_Image`] =
          v === variants[i - 1] ? imageUrls[i - 1] : null;
      }
    }

    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169
    };

    const payload = {
      template_id: templateMap[aspectRatio],
      modifications: mods,
      output_format: 'mp4'
    };

    const r = await postJSON(
      'https://api.creatomate.com/v1/renders',
      `Bearer ${process.env.CREATOMATE_API_KEY}`,
      payload
    );

    return res.status(200).json({ ok: true, job_id: r.json.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message });
  }
};
