// api/create-video.js (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'krea').toLowerCase();

// ---------- Krea ----------
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_GENERATE_URL =
  process.env.KREA_GENERATE_URL || 'https://api.krea.ai/generate/image/bfl/flux-1-dev';
const KREA_JOB_URL_BASE = process.env.KREA_JOB_URL_BASE || 'https://api.krea.ai/jobs';

const KREA_STYLE_ID = (process.env.KREA_STYLE_ID || 'tvjlqsab9').trim();
const KREA_STYLE_STRENGTH = Number(process.env.KREA_STYLE_STRENGTH || 0.85);

// ---------- Beats ----------
const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT_ESTIMATE = 3.0;

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

// ---------- Text helpers ----------
function estimateSpeechSeconds(narration) {
  const text = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  return words / 2.5;
}
function countWords(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}
function splitIntoSentences(text) {
  const t = (text || '').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  return parts.map((s) => s.trim()).filter(Boolean);
}
function splitLongSentence(sentence, maxWords) {
  const words = String(sentence || '').split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [String(sentence).trim()];
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) {
    out.push(words.slice(i, i + maxWords).join(' ').trim());
  }
  return out.filter(Boolean);
}

// Sentence-aware beats
function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || '').trim();
  if (!text || beatCount <= 0) return [];

  const totalWords = countWords(text);
  const targetWordsPerBeat = Math.max(8, Math.round(totalWords / beatCount));

  let sentences = splitIntoSentences(text);
  const maxSentenceWords = Math.max(18, targetWordsPerBeat * 2);
  sentences = sentences.flatMap((s) => splitLongSentence(s, maxSentenceWords));

  const beats = [];
  let current = '';
  let currentWords = 0;

  for (const s of sentences) {
    const w = countWords(s);
    if (current && currentWords + w > targetWordsPerBeat) {
      beats.push(current.trim());
      current = '';
      currentWords = 0;
    }
    current += (current ? ' ' : '') + s;
    currentWords += w;
  }
  if (current.trim()) beats.push(current.trim());

  while (beats.length > beatCount) {
    let bestIdx = 0;
    let bestLen = Infinity;
    for (let i = 0; i < beats.length - 1; i++) {
      const len = countWords(beats[i]) + countWords(beats[i + 1]);
      if (len < bestLen) {
        bestLen = len;
        bestIdx = i;
      }
    }
    beats.splice(bestIdx, 2, `${beats[bestIdx]} ${beats[bestIdx + 1]}`.trim());
  }

  while (beats.length < beatCount) beats.push(beats[beats.length - 1] || text);
  return beats;
}

// ---------- Timing ----------
function beatDurationFromText(text) {
  const words = countWords(text);
  const speechSeconds = words / 2.5;
  const padded = speechSeconds + 0.6;
  return Math.max(2.5, Math.min(7.0, padded));
}
function buildBeatTiming(beatTexts) {
  const durations = beatTexts.map(beatDurationFromText);
  let t = 0;
  const starts = durations.map((d) => {
    const s = t;
    t += d;
    return s;
  });
  return { durations, starts, total: t };
}

// ---------- Krea ----------
async function createKreaJob(prompt, aspectRatio) {
  if (!KREA_API_KEY) throw new Error('KREA_API_KEY not set');

  const payload = {
    prompt,
    aspect_ratio: aspectRatio,
    styles: KREA_STYLE_ID ? [{ id: KREA_STYLE_ID, strength: KREA_STYLE_STRENGTH }] : undefined,
  };

  const resp = await fetch(KREA_GENERATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KREA_API_KEY}`, 'Content-Type': 'application/json' },
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
      if (!imageUrl) throw new Error('KREA_JOB_NO_RESULT_URL');
      return imageUrl;
    }

    if (status === 'failed' || status === 'error') throw new Error('KREA_JOB_FAILED');
    await new Promise((r) => setTimeout(r, 2500));
  }

  throw new Error('KREA_JOB_TIMEOUT');
}

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

    console.log('[KREA] PROMPT', { beat: i, prompt });

    const jobId = await createKreaJob(prompt, aspectRatio);
    const imageUrl = await pollKreaJob(jobId);

    console.log('[KREA] IMAGE', { beat: i, imageUrl });

    urls.push(imageUrl);
  }

  return urls;
}

// ---------- Variants ----------
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

    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();
    if (!template_id) return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });

    const baseUrl = `https://${req.headers.host}`;

    // Script
    const scriptResp = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyType, artStyle, language, customPrompt, durationRange }),
    }).then((r) => r.json());

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // beat count
    const speechSec = estimateSpeechSeconds(narration);
    let targetSec = Math.round(speechSec + 2);
    let minSec = 60, maxSec = 90;
    if (durationRange === '30-60') { minSec = 30; maxSec = 60; }
    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec) targetSec = maxSec;

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT_ESTIMATE);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);
    const timing = buildBeatTiming(beatTexts);
    const variantSequence = buildVariantSequence(beatCount);

    // images
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

    const mods = {
      Narration: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,

      // Creatomate voice only
      Voiceover: narration,
      VoiceUrl: null,

      'Captions_JSON.text': '',
    };

    // ✅ Correct timing:
    // Scene is absolute, group is relative inside scene (start at 0)
    for (let i = 1; i <= beatCount; i++) {
      const start = timing.starts[i - 1];
      const dur = timing.durations[i - 1];

      mods[`Beat${i}_Scene.time`] = start;
      mods[`Beat${i}_Scene.duration`] = dur;

      mods[`Beat${i}_Group.time`] = 0;
      mods[`Beat${i}_Group.duration`] = dur;
    }

    // clear unused
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Scene.time`] = 0;
      mods[`Beat${i}_Scene.duration`] = 0;

      mods[`Beat${i}_Group.time`] = 0;
      mods[`Beat${i}_Group.duration`] = 0;

      for (const variant of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${variant}_Image.source`] = '';
      }
    }

    // images (proxy) + ✅ Beat 1 forced to PanRight
    let lastGood = '';
    for (let i = 1; i <= beatCount; i++) {
      const raw = imageUrls[i - 1] || '';
      let proxied = raw ? `${baseUrl}/api/krea-image?url=${encodeURIComponent(raw)}` : '';
      if (!proxied && lastGood) proxied = lastGood;
      if (proxied) lastGood = proxied;

      const chosen = (i === 1) ? 'PanRight' : variantSequence[i - 1];

      if (i === 1) {
        console.log('[BEAT1_DEBUG]', {
          raw: raw ? raw.slice(0, 140) : '',
          proxied: proxied ? proxied.slice(0, 180) : '',
          chosen,
          key: `Beat1_${chosen}_Image.source`,
        });
      }

      for (const variant of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${variant}_Image.source`] = (variant === chosen) ? proxied : '';
      }
    }

    const payload = { template_id, modifications: mods, output_format: 'mp4' };

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
