// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'krea').toLowerCase();

// Krea config
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_API_URL =
  process.env.KREA_API_URL || 'https://api.krea.ai/generate/image/bfl/flux-1-dev'; // <-- adjust to real endpoint if different

// Beat / timing settings
const MIN_BEATS = 8;           // never fewer than this
const MAX_BEATS = 24;          // must match how many Beat groups your template supports
const SECONDS_PER_BEAT = 3.0;  // approx seconds per scene (your beats are 3s in Creatomate)

// Animation variants in your Creatomate template
const ANIMATION_VARIANTS = ['PanRight', 'PanLeft', 'PanUp', 'PanDown', 'Zoom'];

// ----------------- CORS -----------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ----------------- Simple HTTPS JSON helper (Creatomate) -----------------
function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(bodyObj);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ''),
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

// ----------------- Speech timing helper (words -> seconds) -----------------
function estimateSpeechSeconds(narration) {
  const text = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  const wordsPerSec = 2.5; // ~150 wpm
  return words / wordsPerSec;
}

/**
 * Split narration into `beatCount` chunks so each beat has its own text.
 * Simple word-based splitter: keeps order, roughly equal lengths.
 */
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

/**
 * Build a scene prompt WITHOUT any style instructions and WITHOUT any negative prompts.
 * Style will be applied via Krea style_id (e.g., tvjlqsab9) instead.
 */
function buildScenePrompt({ beatText, sceneIndex, aspectRatio }) {
  const ratioText =
    aspectRatio === '9:16'
      ? 'Vertical composition, 9:16 aspect ratio.'
      : aspectRatio === '1:1'
      ? 'Square composition, 1:1 aspect ratio.'
      : 'Horizontal composition, 16:9 aspect ratio.';

  // ✅ No style chunk, ✅ No "no ___" constraints
  return `
Scene ${sceneIndex} for a narrated short video.

${ratioText}

Scene description:
${beatText}
`.trim();
}

/**
 * Call Krea's image API for a single prompt and return an image URL.
 * styleId is passed through as "style_id" when provided.
 */
async function generateKreaImageUrl(prompt, { aspectRatio = '9:16', styleId = '' } = {}) {
  if (!KREA_API_KEY) throw new Error('KREA_API_KEY not set');

  const payload = {
    prompt,
    aspect_ratio:
      aspectRatio === '9:16'
        ? '9:16'
        : aspectRatio === '1:1'
        ? '1:1'
        : '16:9',
  };

  // ✅ Apply style ONLY via Krea style id (no prompt words)
  if (styleId && String(styleId).trim()) {
    payload.style_id = String(styleId).trim();
  }

  const resp = await fetch(KREA_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error('[KREA_ERROR]', resp.status, data);
    throw new Error(`Krea image error: ${resp.status}`);
  }

  const url =
    data?.images?.[0]?.url ||
    data?.data?.[0]?.url ||
    data?.output?.[0]?.image_url ||
    data?.image_url ||
    null;

  if (!url) {
    console.error('[KREA_ERROR] No image URL in response', data);
    throw new Error('Krea image missing URL');
  }

  return url;
}

/**
 * Generate one Krea image per beat and return an array of URLs.
 * On error we push null for that beat (no reuse).
 */
async function generateKreaImageUrlsForBeats({
  beatCount,
  beatTexts,
  aspectRatio,
  styleId,
}) {
  const urls = [];

  for (let i = 1; i <= beatCount; i++) {
    const beatText = beatTexts[i - 1] || beatTexts[beatTexts.length - 1] || '';
    const prompt = buildScenePrompt({
      beatText,
      sceneIndex: i,
      aspectRatio,
    });

    console.log('================ PROMPT_BEAT_%d ================', i);
    console.log(prompt);
    console.log('=================================================');

    try {
      console.log(`[KREA] Generating image for Beat ${i}/${beatCount} (style_id=${styleId || 'none'})`);
      const url = await generateKreaImageUrl(prompt, { aspectRatio, styleId });
      urls.push(url);
    } catch (err) {
      console.error(`[KREA] Beat ${i} failed, leaving this beat without an image`, err);
      urls.push(null);
    }
  }

  return urls;
}

/**
 * Build a sequence of animation variants for all beats
 * so that no two consecutive beats use the same variant.
 */
function buildVariantSequence(beatCount) {
  const seq = [];
  let last = null;

  for (let i = 0; i < beatCount; i++) {
    const available = ANIMATION_VARIANTS.filter((v) => v !== last);
    const idx = i % available.length;
    const chosen = available[idx];
    seq.push(chosen);
    last = chosen;
  }

  return seq;
}

/**
 * Call our /api/voice-captions route to get voiceUrl + captions.
 */
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
    voiceUrl: data.voiceUrl,
    captions: Array.isArray(data.captions) ? data.captions : [],
  };
}

// ----------------- MAIN HANDLER -----------------
module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : req.body || {};

    const {
      storyType = 'Random AI story',
      artStyle = 'Creepy Toon', // label only (optional)
      language = 'English',
      voice = 'Adam',
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90',
      voice_url = null,

      // ✅ NEW: style fields from Webflow
      styleKey = '',
      styleId = '', // <-- you want tvjlqsab9 here
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Pick template ID by aspect ratio
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1': process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();
    if (!template_id) {
      return res.status(400).json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // 1) Get narration from generate-script
    const baseUrl = `https://${req.headers.host}`;
    const scriptUrl = `${baseUrl}/api/generate-script`;

    const scriptResp = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storyType,
        artStyle,       // still used for script flavor, not image style
        language,
        customPrompt,
        durationRange,
      }),
    }).then((r) => r.json());

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      console.error('[CREATE_VIDEO] SCRIPT_EMPTY', scriptResp);
      return res.status(502).json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // 2) Voice + captions
    let voiceUrl = null;
    let captions = [];
    try {
      const vc = await getVoiceAndCaptions(baseUrl, narration, language);
      voiceUrl = vc.voiceUrl;
      captions = vc.captions || [];
    } catch (e) {
      console.error('[CREATE_VIDEO] getVoiceAndCaptions failed, continuing without captions', e);
    }

    // 3) Estimate narration time & decide beats
    const speechSec = estimateSpeechSeconds(narration);

    let targetSec = Math.round(speechSec + 2);
    let minSec = durationRange === '30-60' ? 30 : 60;
    let maxSec = durationRange === '30-60' ? 60 : 90;

    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec && targetSec < maxSec + 10) {
      // small overflow ok
    } else if (targetSec > maxSec + 10) {
      targetSec = Math.round(speechSec + 2);
    }

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    // 4) Build beatTexts
    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 5) Generate images (Krea) using ONLY style_id, no prompt styling, no negatives
    let imageUrls = [];
    if (IMAGE_PROVIDER === 'krea') {
      try {
        imageUrls = await generateKreaImageUrlsForBeats({
          beatCount,
          beatTexts,
          aspectRatio,
          styleId: String(styleId || '').trim(), // <-- tvjlqsab9
        });
      } catch (err) {
        console.error('[CREATE_VIDEO] KREA_BATCH_FAILED', err);
        imageUrls = [];
      }
    }

    // 6) Animation sequence
    const variantSequence = buildVariantSequence(beatCount);

    // 7) Creatomate modifications
    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      ArtStyleLabel: artStyle,
      StyleKeyLabel: styleKey,
      StyleIdLabel: styleId,
    };

    if (voiceUrl) {
      mods.VoiceUrl = voiceUrl;
      if (captions.length) mods['Captions_JSON.text'] = JSON.stringify(captions);
    }
    if (voice_url) mods.voice_url = voice_url;

    // Fill active beats 1..beatCount
    for (let i = 1; i <= beatCount; i++) {
      const imageUrl = (IMAGE_PROVIDER === 'krea' && imageUrls.length >= i) ? (imageUrls[i - 1] || null) : null;
      const chosenVariant = variantSequence[i - 1];

      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        mods[imgKey] = (variant === chosenVariant) ? imageUrl : null;
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

    // 8) Call Creatomate
    const resp = await postJSON(
      'https://api.creatomate.com/v1/renders',
      { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      payload
    );

    if (resp.status !== 202 && resp.status !== 200) {
      console.error('[CREATOMATE_ERROR]', resp.status, resp.json);
      return res.status(resp.status).json({ error: 'CREATOMATE_ERROR', details: resp.json });
    }

    const job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
    if (!job_id) {
      console.error('[CREATE_VIDEO] NO_JOB_ID_IN_RESPONSE', resp.json);
      return res.status(502).json({ error: 'NO_JOB_ID_IN_RESPONSE', details: resp.json });
    }

    return res.status(200).json({ ok: true, job_id });
  } catch (err) {
    console.error('[CREATE_VIDEO] SERVER_ERROR', err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: String(err?.message || err) });
  }
};
