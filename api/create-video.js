// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'krea').toLowerCase();

// ---------- Krea ----------
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL =
  process.env.KREA_GENERATE_URL || 'https://api.krea.ai/generate/image/bfl/flux-1-dev';
const KREA_JOB_URL_BASE = process.env.KREA_JOB_URL_BASE || 'https://api.krea.ai/jobs';

// style id (your creepy toon id)
const KREA_STYLE_ID = (process.env.KREA_STYLE_ID || 'tvjlqsab9').trim();
const KREA_STYLE_STRENGTH = Number(process.env.KREA_STYLE_STRENGTH || 0.85);

// ---------- Beats ----------
const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT = 3.0;

const ANIMATION_VARIANTS = ['PanRight', 'PanLeft', 'PanUp', 'PanDown', 'Zoom'];

// ---------- CORS ----------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ---------- HTTPS JSON helper (Creatomate) ----------
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

// ---------- Speech timing ----------
function estimateSpeechSeconds(narration) {
  const text = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  return words / 2.5; // ~150 wpm
}

function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || '').trim();
  if (!text || beatCount <= 0) return [];

  const words = text.split(/\s+/);
  const totalWords = words.length;
  const chunkSize = Math.max(1, Math.ceil(totalWords / beatCount));

  const beats = [];
  for (let i = 0; i < totalWords; i += chunkSize) {
    beats.push(words.slice(i, i + chunkSize).join(' '));
  }

  if (beats.length > beatCount) beats.length = beatCount;
  while (beats.length < beatCount) beats.push(beats[beats.length - 1] || text);

  return beats;
}

// ---------- Krea: create job + poll until complete ----------
async function createKreaJob(prompt, aspectRatio) {
  if (!KREA_API_KEY) throw new Error('KREA_API_KEY not set');

  const payload = {
    prompt,
    aspect_ratio: aspectRatio,
    // Apply style via styles array (as Krea AI said)
    styles: KREA_STYLE_ID
      ? [{ id: KREA_STYLE_ID, strength: KREA_STYLE_STRENGTH }]
      : undefined,
  };

  const resp = await fetch(KREA_GENERATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error('[KREA_GENERATE_ERROR]', data);
    throw new Error('KREA_GENERATE_FAILED');
  }

  const jobId = data?.job_id || data?.id;
  if (!jobId) {
    console.error('[KREA_GENERATE_ERROR] Missing job_id', data);
    throw new Error('KREA_MISSING_JOB_ID');
  }

  return jobId;
}

async function pollKreaJob(jobId) {
  const url = `${KREA_JOB_URL_BASE}/${encodeURIComponent(jobId)}`;

  for (let i = 0; i < 90; i++) {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${KREA_API_KEY}` },
    });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error('[KREA_JOB_ERROR]', resp.status, data);
      throw new Error('KREA_JOB_LOOKUP_FAILED');
    }

    const status = String(data?.status || '').toLowerCase();

    if (status === 'completed' || status === 'complete' || status === 'succeeded') {
      const urls = data?.result?.urls || data?.urls || [];
      const imageUrl = Array.isArray(urls) ? urls[0] : null;
      if (!imageUrl) {
        console.error('[KREA_JOB_ERROR] Completed but no result urls', data);
        throw new Error('KREA_JOB_NO_RESULT_URL');
      }
      return imageUrl;
    }

    if (status === 'failed' || status === 'error') {
      console.error('[KREA_JOB_ERROR] Job failed', data);
      throw new Error('KREA_JOB_FAILED');
    }

    await new Promise((r) => setTimeout(r, 2500));
  }

  throw new Error('KREA_JOB_TIMEOUT');
}

// You said: no style prompt text, no negative prompts.
// This is the smallest prompt that still makes images match the story.
function buildPromptForBeat({ beatText, storyType, artStyle, sceneIndex }) {
  const t = (beatText || '').trim();
  const st = (storyType || '').trim();
  const as = (artStyle || '').trim();
  return `Scene ${sceneIndex}. Story type: ${st}. Art style: ${as}. ${t}`;
}

async function generateKreaImageUrlsForBeats({ beatCount, beatTexts, storyType, artStyle, aspectRatio }) {
  const urls = [];

  for (let i = 1; i <= beatCount; i++) {
    const beatText = beatTexts[i - 1] || '';
    const prompt = buildPromptForBeat({ beatText, storyType, artStyle, sceneIndex: i });

    try {
      const jobId = await createKreaJob(prompt, aspectRatio);
      const imageUrl = await pollKreaJob(jobId);
      urls.push(imageUrl);
    } catch (err) {
      console.error(`[KREA] Beat ${i} failed`, err);
      urls.push(null);
    }
  }

  return urls;
}

// ---------- Animation sequence ----------
function buildVariantSequence(beatCount) {
  const seq = [];
  let last = null;

  for (let i = 0; i < beatCount; i++) {
    const available = ANIMATION_VARIANTS.filter((v) => v !== last);
    const chosen = available[i % available.length];
    seq.push(chosen);
    last = chosen;
  }

  return seq;
}

// ---------- voice-captions endpoint ----------
async function getVoiceAndCaptions(baseUrl, narration, language) {
  const resp = await fetch(`${baseUrl}/api/voice-captions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ narration, language }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    console.error('[CREATE_VIDEO] voice-captions failed', resp.status, data);
    throw new Error('VOICE_CAPTIONS_FAILED');
  }

  return {
    voiceUrl: data.voiceUrl || null,
    captions: Array.isArray(data.captions) ? data.captions : [],
  };
}

// ---------- MAIN ----------
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      storyType = 'Random AI story',
      artStyle = 'Scary toon',
      language = 'English',
      voice = 'Adam',
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90',
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Template by aspect ratio
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();
    if (!template_id) return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });

    // 1) Get narration
    const baseUrl = `https://${req.headers.host}`;
    const scriptResp = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyType, artStyle, language, customPrompt, durationRange }),
    }).then((r) => r.json());

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // 2) Voice + captions (THIS is the voice you said you want)
    let voiceUrl = null;
    let captions = [];
    try {
      const vc = await getVoiceAndCaptions(baseUrl, narration, language);
      voiceUrl = vc.voiceUrl;
      captions = vc.captions || [];
    } catch (e) {
      console.error('[CREATE_VIDEO] getVoiceAndCaptions failed', e);
    }

    // 3) Beats
    const speechSec = estimateSpeechSeconds(narration);
    let targetSec = Math.round(speechSec + 2);
    let minSec = 60, maxSec = 90;
    if (durationRange === '30-60') { minSec = 30; maxSec = 60; }
    if (targetSec < minSec) targetSec = minSec;

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 4) Krea images
    let imageUrls = [];
    if (IMAGE_PROVIDER === 'krea') {
      imageUrls = await generateKreaImageUrlsForBeats({
        beatCount,
        beatTexts,
        storyType,
        artStyle,
        aspectRatio,
      });
    }

    // 5) Anim sequence
    const variantSequence = buildVariantSequence(beatCount);

    // 6) Creatomate mods using YOUR EXACT NAMES
    const mods = {
      Narration: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
    };

    // ✅ Use ONLY VoiceUrl (your old pipeline voice).
    // ✅ Disable Voiceover to avoid the default TTS line / double voices.
    mods.VoiceUrl = voiceUrl || null;
    mods.Voiceover = ''; // important: stops "This text is read aloud"

    // ✅ Captions variable name EXACT
    if (captions.length) {
      mods['Captions_JSON.text'] = JSON.stringify(captions);
    } else {
      mods['Captions_JSON.text'] = '';
    }

    // 7) Beat images (NO .source!)
    for (let i = 1; i <= beatCount; i++) {
      const imageUrl = imageUrls[i - 1] || null;
      const chosenVariant = variantSequence[i - 1];

      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        mods[imgKey] = variant === chosenVariant ? imageUrl : null;
      }
    }

    // Clear unused beats
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      for (const variant of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${variant}_Image`] = null;
      }
    }

    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
    };

    const resp = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    if (resp.status !== 202 && resp.status !== 200) {
      return res.status(resp.status).json({ error: 'CREATOMATE_ERROR', details: resp.json });
    }

    const job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
    if (!job_id) return res.status(502).json({ error: 'NO_JOB_ID_IN_RESPONSE', details: resp.json });

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO] SERVER_ERROR', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: String(err?.message || err) });
  }
};
