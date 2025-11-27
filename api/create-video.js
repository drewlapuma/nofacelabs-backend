// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN       = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER     = (process.env.IMAGE_PROVIDER || 'stability').toLowerCase();
const STABILITY_API_KEY  = process.env.STABILITY_API_KEY;
// One of: 'sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium', 'sd3.5-flash'
const STABILITY_IMAGE_MODEL = process.env.STABILITY_IMAGE_MODEL || 'sd3.5-large-turbo';

// Beat / timing settings
const MIN_BEATS        = 8;    // never fewer than this
const MAX_BEATS        = 24;   // must match how many Beat groups your template supports
const SECONDS_PER_BEAT = 2.5;  // 👈 match your Creatomate beat length

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
  const text  = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  const wordsPerSec = 2.5; // ~150 wpm
  return words / wordsPerSec;
}

/**
 * Simple word-based splitter: split narration into `beatCount` chunks,
 * roughly equal word counts, in order.
 */
function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || '').trim();
  if (!text || beatCount <= 0) return [];

  const words = text.split(/\s+/);
  const totalWords = words.length;
  const chunkSize = Math.max(1, Math.ceil(totalWords / beatCount));

  const beats = [];
  for (let i = 0; i < totalWords; i += chunkSize) {
    const chunkWords = words.slice(i, i + chunkSize);
    beats.push(chunkWords.join(' '));
  }

  // Trim extra chunks if any
  if (beats.length > beatCount) {
    beats.length = beatCount;
  }

  // Pad if fewer (edge cases)
  while (beats.length < beatCount) {
    beats.push(beats[beats.length - 1] || text);
  }

  return beats;
}

/**
 * Build a visual prompt for a scene, based on the *beat text* + artStyle.
 * Uses your scary-toon TikTok-style spec when artStyle includes "scary" or "toon".
 */
function buildScenePrompt({ beatText, artStyle, sceneIndex, aspectRatio }) {
  const styleRaw = (artStyle || '').toLowerCase();

  let styleChunk;

  // Scary toon style
  if (styleRaw.includes('scary') || styleRaw.includes('toon')) {
    styleChunk =
      'Cartoon storytelling illustration in the style of viral TikTok story animations: ' +
      'clean bold outlines, soft cel-shading, smooth gradients, expressive characters, ' +
      'light anime influence, high contrast lighting, slightly exaggerated proportions, ' +
      'cinematic framing, vibrant but not neon colors, simple textured backgrounds, ' +
      'smooth line art, crisp edges, digital painting, storybook vibe, ' +
      'no comic panels, no multiple frames, single scene only. ' +
      'Darker mood with spooky atmosphere, still family-friendly, no gore or graphic violence, ' +
      'no photorealistic faces, no pretty girls, no selfies, no portraits.';
  } else {
    // Generic cartoon / story style
    styleChunk =
      '2d digital cartoon storytelling illustration, flat colors with soft shading, ' +
      'clean bold outlines, expressive characters, light anime influence, cinematic framing, ' +
      'vibrant but not neon colors, simple textured backgrounds, smooth line art, crisp edges, ' +
      'digital painting, storybook vibe, no comic panels, no multiple frames, single scene only, ' +
      'no selfies or fashion shots.';
  }

  const ratioText =
    aspectRatio === '9:16'
      ? 'vertical 9:16 composition'
      : aspectRatio === '1:1'
      ? 'square 1:1 composition'
      : 'horizontal 16:9 composition';

  return `
Scene ${sceneIndex} from a narrated TikTok horror story.

Narration for this scene:
"${beatText}"

Visual style: ${styleChunk}, ${ratioText}, no text, no subtitles, no user interface, no watermarks, no logos, no borders.
`.trim();
}

/**
 * Call Stability's image API for a single prompt.
 * Uses multipart/form-data (required by Stability) and returns a Buffer.
 */
async function generateStabilityImageBuffer(prompt, { aspectRatio = '9:16', artStyle = 'Scary toon' } = {}) {
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

  // Aggressive negative prompt to avoid random girls, portraits, etc.
  const negativePrompt =
    'photorealistic, realistic photography, selfie, portrait, close-up face, pretty girl, attractive woman, ' +
    'fashion, glamour, makeup, lipstick, beauty shot, instagram style, tiktok influencer, ' +
    'nsfw, gore, blood, violence, weapons, text, subtitles, captions, UI, watermark, logo, border, ' +
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
 * Generate one Stability image per beat (using beatTexts) and return an array of URLs.
 * Logs the exact prompt used for each beat.
 */
async function generateStabilityImageUrlsForBeats({
  beatCount,
  beatTexts,
  artStyle,
  aspectRatio,
}) {
  const urls = [];

  for (let i = 1; i <= beatCount; i++) {
    const beatText =
      beatTexts[i - 1] || beatTexts[beatTexts.length - 1] || '';

    const prompt = buildScenePrompt({
      beatText,
      artStyle,
      sceneIndex: i,
      aspectRatio,
    });

    // 🔍 Log exactly what we send to Stability for this beat
console.log(`\n================ PROMPT_BEAT_${i} ================\n${prompt}\n=================================================\n`);

    try {
      console.log(`[STABILITY] Generating image for Beat ${i}/${beatCount}`);
      const buffer = await generateStabilityImageBuffer(prompt, {
        aspectRatio,
        artStyle,
      });

      const key = `stability-scenes/${Date.now()}-beat-${i}.png`;
      const url = await uploadImageBufferToBlob(buffer, key);

      urls.push(url);
    } catch (err) {
      console.error(
        `[STABILITY] Beat ${i} failed, leaving this beat without an image`,
        err
      );
      urls.push(null); // this beat will have no image if Creatomate has no fallback
    }
  }

  return urls;
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
        : (req.body || {});

    const {
      storyType     = 'Random AI story',
      artStyle      = 'Scary toon',   // Webflow UI can override
      language      = 'English',
      voice         = 'Adam',
      aspectRatio   = '9:16',
      customPrompt  = '',
      durationRange = '60-90', // "30-60" or "60-90"
      voice_url     = null,    // future: ElevenLabs etc.
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Pick template ID by aspect ratio
    const templateMap = {
      '9:16': process.env.CREATO_TEMPLATE_916,
      '1:1' : process.env.CREATO_TEMPLATE_11,
      '16:9': process.env.CREATO_TEMPLATE_169,
    };
    const template_id = (templateMap[aspectRatio] || '').trim();

    if (!template_id) {
      return res
        .status(400)
        .json({ error: 'NO_TEMPLATE_FOR_ASPECT', aspectRatio });
    }

    // 1) Get narration from generate-script
    const baseUrl   = `https://${req.headers.host}`;
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

    // 2) Estimate narration time
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

    // 3) Dynamically decide how many beats to use, based on targetSec
    let beatCount = Math.round(targetSec / SECONDS_PER_BEAT);
    if (!beatCount || !Number.isFinite(beatCount)) {
      beatCount = MIN_BEATS;
    }
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    console.log('[CREATE_VIDEO] BEAT_CONFIG', {
      speechSec,
      targetSec,
      beatCount,
      MIN_BEATS,
      MAX_BEATS,
      SECONDS_PER_BEAT,
    });

    // 4) Build beatTexts based on narration and beatCount
    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 5) Generate Stability images for the beats we are actually using
    let stabilityImageUrls = [];
    if (IMAGE_PROVIDER === 'stability') {
      try {
        stabilityImageUrls = await generateStabilityImageUrlsForBeats({
          beatCount,
          beatTexts,
          artStyle,
          aspectRatio,
        });
      } catch (err) {
        console.error(
          '[CREATE_VIDEO] STABILITY_BATCH_FAILED, falling back to prompts only',
          err
        );
        stabilityImageUrls = [];
      }
    }

    // 6) Build Creatomate modifications
    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      ...(voice_url ? { voice_url } : {}),
    };

    const style = artStyle || 'Scary toon';

    // Fill active beats 1..beatCount
    for (let i = 1; i <= beatCount; i++) {
      const beatText = beatTexts[i - 1] || '';
      const caption =
        beatText.length > 120 ? beatText.slice(0, 117) + '…' : beatText || `Scene ${i}`;

      mods[`Beat${i}_Caption`] = caption;

      let imageValue = null;

      if (IMAGE_PROVIDER === 'stability' && stabilityImageUrls.length >= i) {
        imageValue = stabilityImageUrls[i - 1] || null;
      } else if (IMAGE_PROVIDER === 'dalle') {
        imageValue = buildScenePrompt({
          beatText,
          artStyle: style,
          sceneIndex: i,
          aspectRatio,
        });
      }

      // To avoid any black frames due to missing variant layers,
      // we set the SAME image URL on all animation variants for this beat.
      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        mods[imgKey] = imageValue || '';
      }
    }

    // Clear any beats above beatCount up to MAX_BEATS
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Caption`] = '';
      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        mods[imgKey] = '';
      }
    }

    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
      // let template + audio drive final duration
    };

    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', {
      template_id_preview: template_id.slice(0, 6) + '…',
      targetSec,
      beatCount,
      imageProvider: IMAGE_PROVIDER,
      stabilityImagesGenerated: stabilityImageUrls.length,
    });

    // 7) Call Creatomate
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
