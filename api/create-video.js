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
  return words / 2.5; // ~150 wpm
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

// Sentence-aware beats (does NOT cut sentences mid-thought)
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

  // Normalize count without breaking sentence packing too much
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

// ---------- Dynamic timing ----------
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

function buildPromptForBeat({ beatText, storyType, artStyle, sceneIndex }) {
  const t = (beatText || '').trim();
  const st = (storyType || '').trim();
  const as = (artStyle || '').trim();

  return [
    `Scene ${sceneIndex}.`,
    `Story type: ${st}.`,
    `Art style: ${as}.`,
    `Same main character across scenes.`,
    `Cinematic framing, clear subject, dramatic lighting.`,
    t,
  ].join(' ');
}

async function generateKreaImageUrlsForBeats({ beatCount, beatTexts, storyType, artStyle, aspectRatio }) {
  const urls = [];

  console.log('[KREA] SETTINGS', {
    generateUrl: KREA_GENERATE_URL,
    jobBase: KREA_JOB_URL_BASE,
    styleId: KREA_STYLE_ID || null,
    styleStrength: KREA_STYLE_STRENGTH,
    aspectRatio,
    beatCount,
  });

  for (let i = 1; i <= beatCount; i++) {
    const beatText = beatTexts[i - 1] || '';
    const prompt = buildPromptForBeat({ beatText, storyType, artStyle, sceneIndex: i });

    console.log('[KREA] PROMPT', { beat: i, prompt });

    try {
      const jobId = await createKreaJob(prompt, aspectRatio);
      console.log('[KREA] JOB_CREATED', { beat: i, jobId });

      const imageUrl = await pollKreaJob(jobId);
      console.log('[KREA] JOB_DONE', { beat: i, imageUrl });

      urls.push(imageUrl);
    } catch (e) {
      console.error('[KREA] FAILED', { beat: i, message: String(e?.message || e) });
      urls.push(null);
    }
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
      voice = 'Adam', // label only
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90',
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();
    if (!template_id) return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });

    const baseUrl = `https://${req.headers.host}`;

    // 1) Script
    const scriptResp = await fetch(`${baseUrl}/api/generate-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyType, artStyle, language, customPrompt, durationRange }),
    }).then((r) => r.json());

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // 2) Beat count
    const speechSec = estimateSpeechSeconds(narration);
    let targetSec = Math.round(speechSec + 2);

    let minSec = 60, maxSec = 90;
    if (durationRange === '30-60') { minSec = 30; maxSec = 60; }
    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec) targetSec = maxSec;

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT_ESTIMATE);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    // 3) Beats
    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 4) Timing (requires BeatX_Group time+duration toggled Dynamic in Creatomate)
    const timing = buildBeatTiming(beatTexts);

    console.log('[CREATE_VIDEO] TIMING_PREVIEW', {
      beatCount,
      totalEstimatedVideoSec: timing.total,
      sample: beatTexts.slice(0, 3).map((t, i) => ({
        beat: i + 1,
        start: timing.starts[i],
        dur: timing.durations[i],
        preview: t.slice(0, 80),
      })),
    });

    // 5) Krea images
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

    // 6) Variants
    const variantSequence = buildVariantSequence(beatCount);

    // 7) Mods
    const mods = {
      Narration: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,

      // ✅ Use ONLY Creatomate Voiceover layer (no external audio)
      Voiceover: narration,
      VoiceUrl: null,

      // captions off for now
      'Captions_JSON.text': '',
    };

    // 8) Apply dynamic time/duration for Beat groups
    for (let i = 1; i <= beatCount; i++) {
      mods[`Beat${i}_Group.time`] = timing.starts[i - 1];
      mods[`Beat${i}_Group.duration`] = timing.durations[i - 1];
    }
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Group.time`] = 0;
      mods[`Beat${i}_Group.duration`] = 0;
    }

    // 9) Image sources with HARD fallback so a beat never has "no image"
    let lastGoodProxied = '';
    for (let i = 1; i <= beatCount; i++) {
      const raw = imageUrls[i - 1] || '';
      let proxied = raw ? `${baseUrl}/api/krea-image?url=${encodeURIComponent(raw)}` : '';

      // If this beat has no URL, reuse last good one (prevents black beats)
      if (!proxied && lastGoodProxied) {
        proxied = lastGoodProxied;
        console.warn('[IMAGE_FALLBACK] reuse last good image', { beat: i });
      }

      if (proxied) lastGoodProxied = proxied;

      const chosenVariant = variantSequence[i - 1];

      // Debug the problematic beats + first few
      if (i <= 3 || i === 14) {
        console.log('[BEAT_MEDIA_DEBUG]', {
          beat: i,
          chosenVariant,
          raw: raw ? raw.slice(0, 120) : '',
          proxied: proxied ? proxied.slice(0, 180) : '',
          keyUsed: `Beat${i}_${chosenVariant}_Image.source`,
        });
      }

      for (const variant of ANIMATION_VARIANTS) {
        const layer = `Beat${i}_${variant}_Image`;
        const key = `${layer}.source`;

        // Only ONE variant gets the source; others disabled
        mods[key] = (variant === chosenVariant) ? proxied : '';
      }
    }

    // Clear unused beat image sources
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      for (const variant of ANIMATION_VARIANTS) {
        mods[`Beat${i}_${variant}_Image.source`] = '';
      }
    }

    console.log('[CREATE_VIDEO] PAYLOAD_CHECK', {
      template_id,
      beatCount,
      beat14: {
        t: mods['Beat14_Group.time'],
        d: mods['Beat14_Group.duration'],
        pr: mods['Beat14_PanRight_Image.source'] ? 'set' : 'empty',
        pu: mods['Beat14_PanUp_Image.source'] ? 'set' : 'empty',
        zl: mods['Beat14_Zoom_Image.source'] ? 'set' : 'empty',
      },
    });

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
