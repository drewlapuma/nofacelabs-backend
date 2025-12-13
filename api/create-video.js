// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'krea').toLowerCase();

// Krea config
const KREA_API_KEY = process.env.KREA_API_KEY;

// IMPORTANT: Your 404 is almost certainly because this endpoint is wrong.
// Set KREA_API_URL in Vercel env to the correct Krea endpoint you’re using.
const KREA_API_URL = process.env.KREA_API_URL || 'https://api.krea.ai/v1/images';

// Default style id (your Creepy Toon)
const DEFAULT_KREA_STYLE_ID = process.env.KREA_STYLE_ID || 'tvjlqsab9';

// Beat / timing settings
const MIN_BEATS = 8;
const MAX_BEATS = 24;
const SECONDS_PER_BEAT = 3.0;

// Creatomate animation variants
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

// ----------------- Speech timing helper -----------------
function estimateSpeechSeconds(narration) {
  const text = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  const wordsPerSec = 2.5; // ~150 wpm
  return words / wordsPerSec;
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

/**
 * ✅ NO style prompt
 * ✅ NO negative prompts
 *
 * We only describe what to draw, and let Krea style_id handle the look.
 */
function buildScenePrompt({ beatText, sceneIndex, aspectRatio }) {
  const ratioText =
    aspectRatio === '9:16'
      ? 'Vertical composition (9:16).'
      : aspectRatio === '1:1'
      ? 'Square composition (1:1).'
      : 'Horizontal composition (16:9).';

  return `
Scene ${sceneIndex}.
${ratioText}

Story narration for this scene:
${beatText}
`.trim();
}

/**
 * Call Krea API for a single prompt and return an image URL.
 * This function is defensive because the endpoint/shape may differ.
 */
async function generateKreaImageUrl(prompt, { aspectRatio = '9:16', styleId } = {}) {
  if (!KREA_API_KEY) throw new Error('KREA_API_KEY not set');
  if (!KREA_API_URL) throw new Error('KREA_API_URL not set');

  const payload = {
    prompt,
    aspect_ratio:
      aspectRatio === '9:16'
        ? '9:16'
        : aspectRatio === '1:1'
        ? '1:1'
        : '16:9',

    // ✅ Use the Krea style id for the look
    style_id: styleId || DEFAULT_KREA_STYLE_ID,
  };

  const resp = await fetch(KREA_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KREA_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // Read text first so we can log it even if JSON parsing fails
  const rawText = await resp.text().catch(() => '');
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { raw: rawText };
  }

  if (!resp.ok) {
    console.error('[KREA_ERROR]', {
      status: resp.status,
      url: KREA_API_URL,
      payloadPreview: {
        aspect_ratio: payload.aspect_ratio,
        style_id: payload.style_id,
        promptPreview: String(prompt || '').slice(0, 140),
      },
      response: data,
    });
    throw new Error(`Krea image error: ${resp.status}`);
  }

  // Try common response shapes
  const url =
    data?.images?.[0]?.url ||
    data?.data?.[0]?.url ||
    data?.output?.[0]?.image_url ||
    data?.image_url ||
    data?.url ||
    null;

  if (!url) {
    console.error('[KREA_ERROR] No image URL in response', data);
    throw new Error('Krea image missing URL');
  }

  return url;
}

async function generateKreaImageUrlsForBeats({
  beatCount,
  beatTexts,
  aspectRatio,
  kreaStyleId,
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
      console.log(`[KREA] Generating image for Beat ${i}/${beatCount}`);
      const url = await generateKreaImageUrl(prompt, {
        aspectRatio,
        styleId: kreaStyleId || DEFAULT_KREA_STYLE_ID,
      });
      urls.push(url);
    } catch (err) {
      console.error(`[KREA] Beat ${i} failed, leaving this beat without an image`, err);
      urls.push(null);
    }
  }

  return urls;
}

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
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    const {
      storyType = 'Random AI story',
      artStyle = 'Creepy Toon',
      language = 'English',
      voice = 'Adam',
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90',
      voice_url = null,

      // ✅ allow passing style id from Webflow later if you want
      krea_style_id = null,
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
        artStyle,
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

    // 3) Beats
    const speechSec = estimateSpeechSeconds(narration);

    let targetSec = Math.round(speechSec + 2);
    let minSec = durationRange === '30-60' ? 30 : 60;
    let maxSec = durationRange === '30-60' ? 60 : 90;

    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec + 10) targetSec = Math.round(speechSec + 2);

    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT);
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = MIN_BEATS;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 4) Images (Krea)
    let imageUrls = [];
    if (IMAGE_PROVIDER === 'krea') {
      imageUrls = await generateKreaImageUrlsForBeats({
        beatCount,
        beatTexts,
        aspectRatio,
        kreaStyleId: krea_style_id || DEFAULT_KREA_STYLE_ID,
      });
    }

    // 5) Variants + mods
    const variantSequence = buildVariantSequence(beatCount);

    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
    };

    if (voiceUrl) {
      mods.VoiceUrl = voiceUrl;
      if (captions.length) mods['Captions_JSON.text'] = JSON.stringify(captions);
    }

    if (voice_url) {
      mods.voice_url = voice_url;
    }

    for (let i = 1; i <= beatCount; i++) {
      const imageUrl = (IMAGE_PROVIDER === 'krea' && imageUrls.length >= i) ? (imageUrls[i - 1] || null) : null;
      const chosenVariant = variantSequence[i - 1];

      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        mods[imgKey] = (variant === chosenVariant) ? imageUrl : null;
      }
    }

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

    // 6) Creatomate render
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
