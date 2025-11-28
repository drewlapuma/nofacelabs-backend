// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN          = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER        = (process.env.IMAGE_PROVIDER || 'stability').toLowerCase();
const STABILITY_API_KEY     = process.env.STABILITY_API_KEY;
const STABILITY_IMAGE_MODEL = process.env.STABILITY_IMAGE_MODEL || 'sd3.5-large-turbo';

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;
const OPENAI_MODEL    = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// Beat / timing settings
const MIN_BEATS        = 8;    // never fewer than this
const MAX_BEATS        = 24;   // must match how many Beat groups your template supports
const SECONDS_PER_BEAT = 3;  // match your Creatomate beat length

// Animation variants in your Creatomate template
// For each beat you have layers like:
// Beat1_PanRight_Image, Beat1_PanLeft_Image, Beat1_PanUp_Image, Beat1_PanDown_Image, Beat1_Zoom_Image
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
 * Fallback: split narration into beats by sentences if beat planner fails.
 */
function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || '').trim();
  if (!text || beatCount <= 0) return [];

  // 1) Rough sentence split
  const rawSentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSentences.length === 0) {
    return [text];
  }

  const total = rawSentences.length;
  const perBeat = Math.max(1, Math.round(total / beatCount));

  const beats = [];
  for (let i = 0; i < total; i += perBeat) {
    const chunk = rawSentences.slice(i, i + perBeat).join(' ');
    beats.push(chunk);
  }

  if (beats.length > beatCount) {
    beats.length = beatCount;
  }
  while (beats.length < beatCount) {
    beats.push(beats[beats.length - 1] || text);
  }

  return beats;
}

/**
 * Build a visual prompt for Stability based on a *visual description* + artStyle.
 * beatText here is assumed to ALREADY be a visual description (from the beat planner).
 */
function buildScenePrompt({ beatText, artStyle, sceneIndex, aspectRatio }) {
  const styleRaw    = (artStyle || '').toLowerCase();
  const cleanedBeat = (beatText || '').replace(/\s+/g, ' ').trim();

  let styleChunk;

  // Scary toon style
  if (styleRaw.includes('scary') || styleRaw.includes('toon')) {
    styleChunk =
      'Cartoon storytelling illustration in the style of viral TikTok horror story animations: ' +
      'clean bold outlines, soft cel-shading, smooth gradients, expressive silhouettes, ' +
      'light anime influence, high contrast lighting, slightly exaggerated proportions, ' +
      'cinematic framing, moody colors, simple textured backgrounds, smooth line art, crisp edges, ' +
      'digital painting, storybook vibe, single frame only, no comic panels, no multiple frames. ' +
      'Spooky atmosphere, eerie lighting, family-friendly, no gore or graphic violence, ' +
      'no photorealistic faces, no pretty girls, no selfies, no close-up portraits.';
  } else {
    // Generic cartoon / story style
    styleChunk =
      '2d digital cartoon storytelling illustration, flat colors with soft shading, ' +
      'clean bold outlines, expressive characters, cinematic framing, ' +
      'vibrant but not neon colors, simple textured backgrounds, smooth line art, crisp edges, ' +
      'digital painting, storybook vibe, single frame only, no comic panels, no multiple frames, ' +
  }

  const ratioText =
    aspectRatio === '9:16'
      ? 'vertical 9:16 composition'
      : aspectRatio === '1:1'
      ? 'square 1:1 composition'
      : 'horizontal 16:9 composition';

  return `
Highly detailed single-frame illustration for scene ${sceneIndex} of a narrated TikTok story.

Scene to visualize (concrete visual description, not just text):
${cleanedBeat}

Visual style: ${styleChunk}, ${ratioText}, no on-screen text, no subtitles, no UI, no watermarks, no logos, no borders.
`.trim();
}

/**
 * Call Stability's image API for a single prompt.
 * Uses multipart/form-data (required by Stability) and returns a Buffer.
 */
async function generateStabilityImageBuffer(
  prompt,
  { aspectRatio = '9:16' } = {}
) {
  if (!STABILITY_API_KEY) {
    throw new Error('STABILITY_API_KEY not set');
  }

  const url = 'https://api.stability.ai/v2beta/stable-image/generate/sd3';

  const form = new FormData();
  form.append('prompt', prompt);
  form.append(
    'aspect_ratio',
    aspectRatio === '9:16' ? '9:16' : aspectRatio === '1:1' ? '1:1' : '16:9'
  );
  form.append('output_format', 'png');
  form.append('model', STABILITY_IMAGE_MODEL);
  form.append('style_preset', 'digital-art');

  const negativePrompt =
    'photorealistic, realistic photography, selfie, portrait, close-up face, pretty girl, attractive woman, ' +
    'fashion, glamour, makeup, lipstick, beauty shot, instagram style, tiktok influencer, ' +
    'text, subtitles, captions, UI, watermark, logo, border, ' +
    'comic panels, multi-frame comic, collage, multiple panels, distorted anatomy, extra limbs, disfigured face';

  form.append('negative_prompt', negativePrompt);

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
  const { put } = await import('@vercel/blob');
  const { url } = await put(key, buffer, {
    access: 'public',
    addRandomSuffix: false,
  });
  return url;
}

/**
 * Generate one Stability image per beat and return an array of URLs.
 * beatVisuals: array of visual descriptions (from beat planner).
 */
async function generateStabilityImageUrlsForBeats({
  beatCount,
  beatVisuals,
  artStyle,
  aspectRatio,
}) {
  const urls = [];

  for (let i = 1; i <= beatCount; i++) {
    const visual =
      beatVisuals[i - 1] || beatVisuals[beatVisuals.length - 1] || '';
    const prompt = buildScenePrompt({
      beatText: visual,
      artStyle,
      sceneIndex: i,
      aspectRatio,
    });

    console.log(
      `\n================ PROMPT_BEAT_${i} ================\n${prompt}\n=================================================\n`
    );

    try {
      console.log(`[STABILITY] Generating image for Beat ${i}/${beatCount}`);
      const buffer = await generateStabilityImageBuffer(prompt, { aspectRatio });

      const key = `stability-scenes/${Date.now()}-beat-${i}.png`;
      const url = await uploadImageBufferToBlob(buffer, key);

      urls.push(url);
    } catch (err) {
      console.error(
        `[STABILITY] Beat ${i} failed, leaving this beat without an image`,
        err
      );
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
    const chosen = available[i % available.length];
    seq.push(chosen);
    last = chosen;
  }

  return seq;
}

/**
 * OpenAI beat planner:
 * Takes full narration and returns beats with:
 * - caption
 * - beat_text
 * - visual_description
 */
async function planBeatsWithOpenAI({
  narration,
  storyType,
  artStyle,
  language,
  minBeats,
  maxBeats,
}) {
  if (!OPENAI_API_KEY) {
    console.warn(
      '[PLAN_BEATS] Missing OPENAI_API_KEY, falling back to naive splitting.'
    );
  }
