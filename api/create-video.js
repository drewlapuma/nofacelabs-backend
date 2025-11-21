// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'dalle').toLowerCase();
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

// One of:
// 'sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium', 'sd3.5-flash'
const STABILITY_IMAGE_MODEL = process.env.STABILITY_IMAGE_MODEL || 'sd3.5-flash';

// Limit how many unique Stability images we generate per video.
// The rest of the beats will REUSE these images with different camera moves.
const STABILITY_MAX_IMAGES = Number(process.env.STABILITY_MAX_IMAGES || 8);

// Animation variants that exist in your Creatomate template
// For each beat you have layers:
// BeatX_PanRight_Image, BeatX_PanLeft_Image, BeatX_PanUp_Image, BeatX_PanDown_Image, BeatX_Zoom_Image
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

// ----------------- Speech timing helper (words -> seconds) -----------------
function estimateSpeechSeconds(narration) {
  const text = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  const wordsPerSec = 2.5; // ~150 wpm
  return words / wordsPerSec;
}

/**
 * Build a visual prompt for a scene, based on the full narration + artStyle.
 * Pushes hard toward 2D cartoon / comic-book style (world.wide.story vibe).
 */
function buildScenePrompt({ narration, artStyle, sceneIndex, aspectRatio }) {
  const styleRaw = (artStyle || '').toLowerCase();

  // Base cartoon style chunk
  let styleChunk =
    '2d digital cartoon illustration, flat shading, bold black outlines, ' +
    'vibrant colors, simple shapes, clean background, high contrast, ' +
    'TikTok documentary story style, highly detailed but clearly 2d, no realism';

  // Slightly darker variant for scary/horror types
  if (styleRaw.includes('scary') || styleRaw.includes('horror')) {
    styleChunk =
      'dark 2d horror cartoon, bold black outlines, eerie lighting, muted colors, ' +
      'spooky atmosphere, cinematic framing, still family-friendly, no gore, no graphic violence';
  }

  const ratioText =
    aspectRatio === '9:16'
      ? 'vertical 9:16 composition'
      : aspectRatio === '1:1'
      ? 'square 1:1 composition'
      : 'horizontal 16:9 composition';

  return `
Scene ${sceneIndex} from this narrated TikTok story:

"${narration}"

Visual style: ${styleChunk}, ${ratioText}, no text, no subtitles, no UI, no watermarks, single frame key art, extremely clean and polished.
`.trim();
}

/**
 * Call Stability's image API for a single prompt.
 * Uses multipart/form-data (required by Stability) and returns a Buffer.
 */
async function generateStabilityImageBuffer(prompt, { aspectRatio = '9:16' } = {}) {
  if (!STABILITY_API_KEY) {
    throw new Error('STABILITY_API_KEY not set');
  }

  // Endpoint path is always /sd3 – model variant is passed in the form
  const url = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';

  const form = new FormData();
  form.append('prompt', prompt);
  form.append(
    'aspect_ratio',
    aspectRatio === '9:16' ? '9:16' : aspectRatio === '1:1' ? '1:1' : '16:9'
  );
  form.append('output_format', 'png');
  form.append('model', STABILITY_IMAGE_MODEL);

  // Strongly bias toward comic/cartoon style
  // You can try 'digital-art' or 'anime' if you want to experiment.
  form.append('style_preset', 'comic-book');

  if (STABILITY_IMAGE_MODEL.startsWith('sd3')) {
    form.append('mode', 'text-to-image');
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STABILITY_API_KEY}`,
      Accept: 'image/*',
    },
    body: form,
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    let parsed;
    try {
      parsed = JSON.parse(errorText);
    } catch {
      parsed = { raw: errorText };
    }
    console.error('[STABILITY_ERROR]', resp.status, parsed);
    throw new Error(`Stability image error: ${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload an image buffer to Vercel Blob and return a public URL.
 */
async function uploadImageBufferToBlob(buffer, key) {
  // @vercel/blob is ESM-only, so we use dynamic import
  const { put } = await import('@vercel/blob');
  const { url } = await put(key, buffer, {
    access: 'public',
    addRandomSuffix: false,
  });
  return url;
}

/**
 * Generate up to STABILITY_MAX_IMAGES images via Stability and return an array of public URLs.
 * We'll reuse these across all beats to save credits.
 */
async function generateStabilityImageUrlsForBeats({
  beatCount,
  narration,
  artStyle,
  aspectRatio,
}) {
  const urls = [];

  const uniqueCount = Math.min(beatCount, STABILITY_MAX_IMAGES);

  for (let i = 1; i <= uniqueCount; i++) {
    const prompt = buildScenePrompt({
      narration,
      artStyle,
      sceneIndex: i,
      aspectRatio,
    });

    try {
      console.log(`[STABILITY] Generating image ${i}/${uniqueCount}`);
      const buffer = await generateStabilityImageBuffer(prompt, { aspectRatio });

      const key = `stability-scenes/${Date.now()}-img-${i}.png`;
      const url = await uploadImageBufferToBlob(buffer, key);

      urls.push(url);
    } catch (err) {
      console.error(`[STABILITY] Image ${i} failed, will fall back to prompt`, err);
      urls.push(null);
    }
  }

  return urls;
}

function pickRandomVariant() {
  const idx = Math.floor(Math.random() * ANIMATION_VARIANTS.length);
  return ANIMATION_VARIANTS[idx];
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
        : req.body || {};

    const {
      storyType = 'Random AI story',
      artStyle = 'Scary toon',   // your Webflow UI can override this
      language = 'English',
      voice = 'Adam',
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90', // "30-60" or "60-90"
      voice_url = null, // future: if you plug in ElevenLabs
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
      return res
        .status(400)
        .json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // 1) Call /api/generate-script on THIS backend to get narration
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

    console.log('[CREATE_VIDEO] SCRIPT_RESP preview', {
      hasNarration: !!scriptResp?.narration,
      storyType,
      artStyle,
      durationRange,
    });

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      console.error('[CREATE_VIDEO] SCRIPT_EMPTY', scriptResp);
      return res
        .status(502)
        .json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // 2) Estimate how long the narration actually is (for logging only)
    const speechSec = estimateSpeechSeconds(narration);

    let targetSec = Math.round(speechSec + 2);
    let minSec = 60;
    let maxSec = 90;
    if (durationRange === '30-60') {
      minSec = 30;
      maxSec = 60;
    }
    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec && targetSec < maxSec + 10) {
      // small overflow ok
    } else if (targetSec > maxSec + 10) {
      targetSec = Math.round(speechSec + 2);
    }

    // 3) Your template has 24 beats; we'll always fill all 24.
    const beatCount = 24;

    // 4) Generate a limited pool of Stability images up front (if enabled)
    let stabilityImageUrls = [];
    if (IMAGE_PROVIDER === 'stability') {
      try {
        stabilityImageUrls = await generateStabilityImageUrlsForBeats({
          beatCount,
          narration,
          artStyle,
          aspectRatio,
        });
      } catch (err) {
        console.error(
          '[CREATE_VIDEO] STABILITY_BATCH_FAILED, falling back to prompts',
          err
        );
        stabilityImageUrls = [];
      }
    }

    // 5) Build Creatomate modifications
    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      ...(voice_url ? { voice_url } : {}),
    };

    const style = artStyle || 'Scary toon';

    for (let i = 1; i <= beatCount; i++) {
      const sceneTitle = `Scene ${i}`;

      let imageUrl;
      if (IMAGE_PROVIDER === 'stability' && stabilityImageUrls.length > 0) {
        // Reuse a limited pool of Stability images across beats
        const idx = (i - 1) % stabilityImageUrls.length;
        imageUrl = stabilityImageUrls[idx] || null;
      } else {
        // Fallback: send a DALL·E-style prompt
        imageUrl = buildScenePrompt({
          narration,
          artStyle: style,
          sceneIndex: i,
          aspectRatio,
        });
      }

      mods[`Beat${i}_Caption`] = sceneTitle;

      // Randomly pick one animation variant for this beat
      const chosenVariant = pickRandomVariant();

      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;

        // In your Creatomate template:
        // - There are 5 layers per beat with these names
        // - Each has its own animation (pan/zoom)
        // - Only the one that receives a non-null source will actually show
        if (variant === chosenVariant && imageUrl) {
          mods[imgKey] = imageUrl;
        } else {
          mods[imgKey] = null;
        }
      }
    }

    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
      // no duration: let template + audio drive actual length
    };

    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', {
      template_id_preview: template_id.slice(0, 6) + '…',
      targetSec,
      beatCount,
      imageProvider: IMAGE_PROVIDER,
      stabilityImagesGenerated: stabilityImageUrls.length,
    });

    // 6) Call Creatomate
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
