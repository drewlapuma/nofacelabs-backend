// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN          = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER        = (process.env.IMAGE_PROVIDER || 'stability').toLowerCase();
const STABILITY_API_KEY     = process.env.STABILITY_API_KEY;
const STABILITY_IMAGE_MODEL = process.env.STABILITY_IMAGE_MODEL || 'sd3.5-large-turbo';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// Beat / timing settings
const MIN_BEATS        = 8;   // never fewer than this
const MAX_BEATS        = 24;  // must match your template
const SECONDS_PER_BEAT = 3;   // 🔔 match your Creatomate beat length

// Animation variants in your Creatomate template
// Beat1_PanRight_Image, Beat1_PanLeft_Image, Beat1_PanUp_Image, Beat1_PanDown_Image, Beat1_Zoom_Image
const ANIMATION_VARIANTS = ['PanRight', 'PanLeft', 'PanUp', 'PanDown', 'Zoom'];

/* ---------------- CORS ---------------- */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/* ---------------- Creatomate helper ---------------- */
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

/* ---------------- Speech timing ---------------- */
function estimateSpeechSeconds(narration) {
  const text = (narration || '').trim();
  if (!text) return 0;
  const words = (text.match(/\S+/g) || []).length;
  const wordsPerSec = 2.5; // ~150 wpm
  return words / wordsPerSec;
}

/* ---------------- Fallback beat splitter ---------------- */
function splitNarrationIntoBeats(narration, beatCount) {
  const text = (narration || '').trim();
  if (!text || beatCount <= 0) return [];

  const rawSentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawSentences.length === 0) {
    return [text];
  }

  const total   = rawSentences.length;
  const perBeat = Math.max(1, Math.round(total / beatCount));

  const beats = [];
  for (let i = 0; i < total; i += perBeat) {
    const chunk = rawSentences.slice(i, i + perBeat).join(' ');
    beats.push(chunk);
  }

  if (beats.length > beatCount) beats.length = beatCount;
  while (beats.length < beatCount) {
    beats.push(beats[beats.length - 1] || text);
  }

  return beats;
}

/* ---------------- Prompt builder for Stability ---------------- */
function buildScenePrompt({ beatText, artStyle, sceneIndex, aspectRatio }) {
  const styleRaw    = (artStyle || '').toLowerCase();
  const cleanedBeat = (beatText || '').replace(/\s+/g, ' ').trim();

  let styleChunk;

  if (styleRaw.includes('scary') || styleRaw.includes('toon')) {
    // Scary Toon
    styleChunk =
      'Cartoon storytelling illustration in the style of viral TikTok horror story animations: ' +
      'clean bold outlines, soft cel-shading, smooth gradients, expressive silhouettes, ' +
      'light anime influence, high contrast lighting, slightly exaggerated proportions, ' +
      'cinematic framing, moody colors, simple textured backgrounds, smooth line art, crisp edges, ' +
      'digital painting, storybook vibe, single frame only, no comic panels, no multiple frames. ' +
      'Spooky atmosphere, eerie lighting, family-friendly, no gore or graphic violence, ' +
      'no photorealistic faces, no pretty girls, no selfies, no close-up portraits.';
  } else {
    // Generic cartoon
    styleChunk =
      '2d digital cartoon storytelling illustration, flat colors with soft shading, ' +
      'clean bold outlines, expressive characters, cinematic framing, ' +
      'vibrant but not neon colors, simple textured backgrounds, smooth line art, crisp edges, ' +
      'digital painting, storybook vibe, single frame only, no comic panels, no multiple frames, ' +
      'no selfies or glamour portraits.';
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

/* ---------------- Stability: make one image ---------------- */
async function generateStabilityImageBuffer(prompt, { aspectRatio = '9:16' } = {}) {
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

/* ---------------- Upload to Vercel Blob ---------------- */
async function uploadImageBufferToBlob(buffer, key) {
  const { put } = await import('@vercel/blob');
  const { url } = await put(key, buffer, {
    access: 'public',
    addRandomSuffix: false,
  });
  return url;
}

/* ---------------- Generate images for beats ---------------- */
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

/* ---------------- Variant sequence (no repeats) ---------------- */
function buildVariantSequence(beatCount) {
  const seq = [];
  let last = null;

  for (let i = 0; i < beatCount; i++) {
    const available = ANIMATION_VARIANTS.filter((v) => v !== last);
    const chosen    = available[i % available.length];
    seq.push(chosen);
    last = chosen;
  }

  return seq;
}

/* ---------------- OpenAI beat planner ---------------- */
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
    return null;
  }

  const trimmedNarration = (narration || '').trim();

  const prompt = `
You are planning scenes for a vertical TikTok story video.

The full narration (voiceover) is:

"${trimmedNarration}"

Your job:

1. Break this narration into a sequence of ${minBeats}–${maxBeats} story beats.
2. Each beat should represent a *visual moment* that could be illustrated as a single frame.
3. For each beat, return:
   - "caption": a short, catchy label (max ~8 words) describing the moment.
   - "beat_text": the exact or lightly edited narration fragment for this moment (what is being *said* around this time).
   - "visual_description": a concrete, literal description of what should appear in the illustration:
       - Describe environment, lighting, important objects, and any characters.
       - Avoid metaphors and abstract feelings; only describe what can actually be drawn.
       - If a human character is present, DO NOT describe them as attractive, pretty, glamorous, or fashionable.
       - Prefer silhouettes or small figures over close-up faces.

Rules:
- Stay faithful to the narration order.
- Do NOT invent new plot events that contradict the narration.
- Each "visual_description" must be a clear single scene, not multiple panels or a comic strip.
- Return ONLY valid JSON with this shape:

{
  "beats": [
    {
      "caption": "short label here",
      "beat_text": "narration fragment here",
      "visual_description": "clear visual scene description here"
    }
  ]
}
`.trim();

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a JSON-only API. Always return strictly valid JSON matching the requested schema. No extra commentary.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error('[PLAN_BEATS] OpenAI error', resp.status, data);
    return null;
  }

  const raw = data?.choices?.[0]?.message?.content?.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('[PLAN_BEATS] JSON parse failed, raw content:', raw);
    return null;
  }

  if (!parsed || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    console.error('[PLAN_BEATS] Parsed JSON missing beats:', parsed);
    return null;
  }

  console.log('[PLAN_BEATS] Got beats:', parsed.beats.length);
  return parsed;
}

/* ---------------- HTTP handler ---------------- */
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
      artStyle      = 'Scary toon',
      language      = 'English',
      voice         = 'Adam',
      aspectRatio   = '9:16',
      customPrompt  = '',
      durationRange = '60-90', // "30-60" or "60-90"
      voice_url     = null,
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

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

    // 1) Get narration
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

    // 2) Duration and beat count from timing
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

    let beatCountFromTiming = Math.round(targetSec / SECONDS_PER_BEAT);
    if (!beatCountFromTiming || !Number.isFinite(beatCountFromTiming)) {
      beatCountFromTiming = MIN_BEATS;
    }
    beatCountFromTiming = Math.max(
      MIN_BEATS,
      Math.min(MAX_BEATS, beatCountFromTiming)
    );

    // 3) Plan beats with OpenAI
    let beats = null;
    try {
      const planned = await planBeatsWithOpenAI({
        narration,
        storyType,
        artStyle,
        language,
        minBeats: MIN_BEATS,
        maxBeats: MAX_BEATS,
      });
      if (planned && Array.isArray(planned.beats) && planned.beats.length > 0) {
        beats = planned.beats;
      }
    } catch (e) {
      console.error('[CREATE_VIDEO] BEAT_PLANNER_FAILED', e);
    }

    let beatCount;
    let captionTexts       = [];
    let visualDescriptions = [];

    if (beats) {
      const plannerLen = beats.length;
      beatCount        = beatCountFromTiming;

      for (let i = 0; i < beatCount; i++) {
        const mappedIndex = Math.floor((i * plannerLen) / beatCount);
        const b           = beats[Math.min(mappedIndex, plannerLen - 1)] || {};

        const label  = (b.caption || b.beat_text || `Scene ${i + 1}`).trim();
        const visual = (b.visual_description || b.beat_text || '').trim();

        captionTexts.push(label);
        visualDescriptions.push(visual);
      }
    } else {
      beatCount = beatCountFromTiming;
      const fallback = splitNarrationIntoBeats(narration, beatCount);
      captionTexts       = fallback;
      visualDescriptions = fallback;
    }

    console.log('[CREATE_VIDEO] BEAT_CONFIG', {
      speechSec,
      targetSec,
      beatCount,
      MIN_BEATS,
      MAX_BEATS,
      SECONDS_PER_BEAT,
      usedPlanner: !!beats,
    });

    // 4) Generate Stability images
    let stabilityImageUrls = [];
    if (IMAGE_PROVIDER === 'stability') {
      try {
        stabilityImageUrls = await generateStabilityImageUrlsForBeats({
          beatCount,
          beatVisuals: visualDescriptions,
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

    // 5) Animation variants
    const variantSequence = buildVariantSequence(beatCount);

    // 6) Creatomate modifications
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
      const rawCaption = captionTexts[i - 1] || `Scene ${i}`;
      const caption =
        rawCaption.length > 120
          ? rawCaption.slice(0, 117) + '…'
          : rawCaption;

      mods[`Beat${i}_Caption`] = caption;

      let imageValue = null;

      if (IMAGE_PROVIDER === 'stability' && stabilityImageUrls.length >= i) {
        imageValue = stabilityImageUrls[i - 1] || null;
      } else if (IMAGE_PROVIDER === 'dalle') {
        const visual = visualDescriptions[i - 1] || '';
        imageValue = buildScenePrompt({
          beatText: visual,
          artStyle: style,
          sceneIndex: i,
          aspectRatio,
        });
      }

      const chosenVariant = variantSequence[i - 1];

      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        if (variant === chosenVariant && imageValue) {
          mods[imgKey] = imageValue;
        } else {
          mods[imgKey] = '';
        }
      }
    }

    // Clear unused beats
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
    };

    console.log('[CREATE_VIDEO] PAYLOAD_PREVIEW', {
      template_id_preview: template_id.slice(0, 6) + '…',
      targetSec,
      beatCount,
      imageProvider: IMAGE_PROVIDER,
      stabilityImagesGenerated: stabilityImageUrls.length,
    });

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
