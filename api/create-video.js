// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'dalle').toLowerCase();
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;
const STABILITY_IMAGE_ENGINE = process.env.STABILITY_IMAGE_ENGINE || 'sd3'; 
// ^ adjust to the exact engine/path you want, e.g. 'sd3', 'sd3-turbo', etc.

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
 * Build a visual prompt for a scene, based on the full narration + artStyle.
 * This is used for BOTH DALL·E (prompt) and Stability (we feed this into their model).
 */
function buildScenePrompt({ narration, artStyle, sceneIndex, aspectRatio }) {
  const style = artStyle || 'Realistic';
  const ratioText = aspectRatio === '9:16'
    ? 'vertical 9:16'
    : aspectRatio === '1:1'
    ? 'square 1:1'
    : 'horizontal 16:9';

  return (
    `${style} style illustration of scene ${sceneIndex} from this story: ${narration} ` +
    `${style} style, ${ratioText}, no text overlay, high quality`
  );
}

/**
 * Call Stability's image API for a single prompt.
 * IMPORTANT: adjust URL/body to exactly match Stability's docs you want to use.
 * This version assumes a JSON text-to-image endpoint that returns base64 PNG.
 */
async function generateStabilityImageDataUrl(prompt, { aspectRatio = '9:16' } = {}) {
  if (!STABILITY_API_KEY) {
    throw new Error('STABILITY_API_KEY not set');
  }

  // Example endpoint - adjust according to Stability docs:
  // e.g. https://api.stability.ai/v2beta/stable-image/generate/sd3
  const url = `https://api.stability.ai/v2beta/stable-image/generate/${STABILITY_IMAGE_ENGINE}`;

  const payload = {
    prompt,
    aspect_ratio: aspectRatio === '9:16' ? '9:16'
                 : aspectRatio === '1:1' ? '1:1'
                 : '16:9',
    output_format: 'png',
    // add other params as needed: cfg_scale, seed, style_preset, etc.
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STABILITY_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error('[STABILITY_ERROR]', resp.status, data);
    throw new Error(`Stability image error: ${resp.status}`);
  }

  // ⚠️ Adjust this to match the actual response shape from Stability.
  // many v2beta endpoints return an array of artifacts with base64 data.
  const base64 =
    data?.artifacts?.[0]?.base64 ||
    data?.image ||
    null;

  if (!base64) {
    console.error('[STABILITY_ERROR] No base64 in response', data);
    throw new Error('Stability image missing base64 data');
  }

  const dataUrl = `data:image/png;base64,${base64}`;
  return dataUrl;
}

/**
 * Generate one image per beat via Stability and return an array of data URLs.
 * If something fails, we log and return null for that slot so we can fall back to DALL·E prompts.
 */
async function generateStabilityImagesForBeats({ beatCount, narration, artStyle, aspectRatio }) {
  const urls = [];

  for (let i = 1; i <= beatCount; i++) {
    const prompt = buildScenePrompt({
      narration,
      artStyle,
      sceneIndex: i,
      aspectRatio,
    });

    try {
      console.log(`[STABILITY] Generating image for Beat ${i}/${beatCount}`);
      const dataUrl = await generateStabilityImageDataUrl(prompt, { aspectRatio });
      urls.push(dataUrl);
    } catch (err) {
      console.error(`[STABILITY] Beat ${i} failed, will fall back to prompt`, err);
      urls.push(null); // we'll fall back to DALL·E-style prompt for this one
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
      artStyle      = 'Realistic',
      language      = 'English',
      voice         = 'Adam',
      aspectRatio   = '9:16',
      customPrompt  = '',
      durationRange = '60-90',   // "30-60" or "60-90"
      voice_url     = null,      // future: if you plug in ElevenLabs
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

    // Map durationRange -> soft bounds in seconds
    let minSec = 60;
    let maxSec = 90;
    if (durationRange === '30-60') {
      minSec = 30;
      maxSec = 60;
    }

    // 1) Call /api/generate-script on THIS backend to get narration
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

    // 2) Estimate how long the narration actually is
    const speechSec = estimateSpeechSeconds(narration);

    // Target duration: at least narration + 2 seconds, inside the chosen bucket if possible
    let targetSec = Math.round(speechSec + 2);

    // gently nudge into the bucket, but NEVER shorter than speechSec + 2
    if (targetSec < minSec) targetSec = minSec;
    if (targetSec > maxSec) {
      if (targetSec < maxSec + 10) {
        // okay to overflow a little
      } else {
        targetSec = Math.round(speechSec + 2);
      }
    }

    // 3) Decide how many beats based on duration
    const MIN_BEATS = 8;
    const MAX_BEATS = 24;  // must match how many Beat slots you made in the template

    let beatCount = Math.round(targetSec / 3.5); // ~3.5s per scene
    if (!beatCount || !Number.isFinite(beatCount)) beatCount = 10;
    beatCount = Math.max(MIN_BEATS, Math.min(MAX_BEATS, beatCount));

    // OPTIONAL: generate Stability images up front if enabled
    let stabilityImageUrls = [];
    if (IMAGE_PROVIDER === 'stability') {
      try {
        stabilityImageUrls = await generateStabilityImagesForBeats({
          beatCount,
          narration,
          artStyle,
          aspectRatio,
        });
      } catch (err) {
        console.error('[CREATE_VIDEO] STABILITY_BATCH_FAILED, falling back to DALL·E prompts', err);
        stabilityImageUrls = [];
      }
    }

    // 4) Build Creatomate modifications
    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      ...(voice_url ? { voice_url } : {}),
    };

    const style = artStyle || 'Realistic';

    for (let i = 1; i <= beatCount; i++) {
      const sceneTitle = `Scene ${i}`;
      const defaultPrompt = buildScenePrompt({
        narration,
        artStyle: style,
        sceneIndex: i,
        aspectRatio,
      });

      // If we have a Stability URL for this beat, use it; otherwise use the original DALL·E prompt
      const imgValue =
        IMAGE_PROVIDER === 'stability' && stabilityImageUrls[i - 1]
          ? stabilityImageUrls[i - 1]
          : defaultPrompt;

      mods[`Beat${i}_Caption`] = sceneTitle;
      mods[`Beat${i}_Image`]   = imgValue;
      mods[`Beat${i}_Visible`] = true;
    }

    // Hide any extra beats in the template above beatCount
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      mods[`Beat${i}_Visible`] = false;
    }

    const payload = {
      template_id,
      modifications: mods,
      output_format: 'mp4',
      duration: targetSec,
    };

    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', {
      template_id_preview: template_id.slice(0, 6) + '…',
      targetSec,
      beatCount,
      imageProvider: IMAGE_PROVIDER,
    });

    // 5) Call Creatomate
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
