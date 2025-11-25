// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'stability').toLowerCase();
const STABILITY_API_KEY = process.env.STABILITY_API_KEY;

// Stability model: 'sd3.5-large', 'sd3.5-large-turbo', 'sd3.5-medium', 'sd3.5-flash'
const STABILITY_IMAGE_MODEL =
  process.env.STABILITY_IMAGE_MODEL || 'sd3.5-large-turbo';

// OpenAI for visual beat planning
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

// Beat / timing settings
const MIN_BEATS = 8;            // never fewer than this
const MAX_BEATS = 24;           // must match how many Beat groups your template supports
const SECONDS_PER_BEAT = 3.5;   // approx seconds per scene

// Animation variants in your Creatomate template
// For each beat you have layers:
// BeatX_PanRight_Image, BeatX_PanLeft_Image, BeatX_PanUp_Image,
// BeatX_PanDown_Image, BeatX_Zoom_Image
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
 * Naive fallback splitter if OpenAI beat planning fails.
 */
function naiveSplitIntoBeats(narration, beatCount) {
  const text = (narration || '').trim();
  if (!text || beatCount <= 0) return [];

  let sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    sentences = [text];
  }

  const chunks = [];
  const totalSentences = sentences.length;
  const sentencesPerChunk = Math.max(1, Math.ceil(totalSentences / beatCount));

  for (let i = 0; i < totalSentences; i += sentencesPerChunk) {
    const group = sentences.slice(i, i + sentencesPerChunk);
    chunks.push(group.join(' '));
  }

  if (chunks.length > beatCount) {
    chunks.length = beatCount;
  }
  while (chunks.length < beatCount) {
    chunks.push(chunks[chunks.length - 1] || text);
  }

  return chunks;
}

/**
 * Build a visual prompt for a scene, based on the *beat text* + artStyle.
 */
function buildScenePrompt({ beatText, artStyle, sceneIndex, aspectRatio }) {
  const styleRaw = (artStyle || '').toLowerCase();

  let styleChunk;

  if (styleRaw.includes('scary') || styleRaw.includes('toon')) {
    styleChunk =
      '2D scary toon horror illustration, digital-art style, clean but soft outlines, ' +
      'smooth shading, simplified shapes, slightly exaggerated proportions, ' +
      'cinematic framing, dark spooky atmosphere, eerie lighting, deep shadows, ' +
      'focus on the environment and the scary presence (monster, unknown figure, dark doorway, hallway, whispers), ' +
      'characters small or silhouetted, reacting to the horror, not glamorized, ' +
      'no realistic photography, no pretty portraits, no slice-of-life scenes, ' +
      'no comic panels, no multiple frames, single full-screen illustration.';
  } else {
    styleChunk =
      '2D illustrated story scene, digital-art style, clean outlines, ' +
      'smooth shading, expressive characters, cinematic framing, ' +
      'vibrant but not neon colors, simple textured backgrounds, ' +
      'digital painting, no comic panels, no multiple frames, single full-scene illustration.';
  }

  const ratioText =
    aspectRatio === '9:16'
      ? 'vertical 9:16 composition'
      : aspectRatio === '1:1'
      ? 'square 1:1 composition'
      : 'horizontal 16:9 composition';

  return `
Scene ${sceneIndex} from a narrated TikTok horror story.

IMPORTANT: Show exactly what this moment of the story describes.
Focus on the room, environment, and the creepy element (shadows, open door, hallway, monster, unknown presence).
Only include a person if they are clearly reacting to the horror (small, not a glamour shot).

Narration for this scene:
"${beatText}"

Visual style: ${styleChunk}, ${ratioText}, no text, no subtitles, no UI, no watermarks, no logos, no borders.
`.trim();
}

/**
 * Use OpenAI to turn narration into a visual beat plan.
 * This version strips ```json fences and forces pure JSON.
 */
async function buildVisualBeatPlan({ narration, storyType, artStyle, beatCount }) {
  if (!OPENAI_API_KEY) {
    console.warn('[BEAT_PLAN] No OPENAI_API_KEY; falling back to naive split.');
    const chunks = naiveSplitIntoBeats(narration, beatCount);
    return chunks.map((t) => ({
      caption: t,
      beat_text: t,
    }));
  }

  const prompt = `
You produce ONLY JSON. 
NEVER wrap your output in backticks or markdown code fences.

Task:
- Break the narration into EXACTLY ${beatCount} visual beats.
- Each beat describes what the viewer SEES on screen at that moment in a scary TikTok story.
- Preserve the chronological order of the story.
- Focus on environment and horror elements: rooms, hallways, doors, windows, shadows, unknown figures, monsters, strange objects, etc.
- Avoid generic "girl standing in bedroom" or "pretty anime girl" framing.
- If a person is needed, treat them as small, secondary silhouettes reacting to the horror, not the main subject.
- 1–2 sentences per beat is enough.
- These are for image generation, NOT subtitles.

Return this JSON format ONLY (no extra fields):

{
  "beats": [
    {
      "caption": "very short caption for this moment",
      "beat_text": "1-2 sentences describing what should be shown on screen"
    }
  ]
}

Make sure there are EXACTLY ${beatCount} beats.

Narration:
"""${narration}"""
`.trim();

  try {
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
              'You are a JSON-only API. Never return backticks or markdown. Output JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.6,
      }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error('[BEAT_PLAN] OpenAI error', resp.status, data);
      const chunks = naiveSplitIntoBeats(narration, beatCount);
      return chunks.map((t) => ({
        caption: t,
        beat_text: t,
      }));
    }

    let raw = data?.choices?.[0]?.message?.content?.trim() || '';

    // 🔧 Strip markdown code fences if OpenAI still adds them
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('[BEAT_PLAN] parse failed, raw:', raw);
      const chunks = naiveSplitIntoBeats(narration, beatCount);
      return chunks.map((t) => ({ caption: t, beat_text: t }));
    }

    let beats = Array.isArray(parsed?.beats) ? parsed.beats : [];
    beats = beats.filter(
      (b) => b && typeof b.beat_text === 'string' && b.beat_text.trim()
    );

    if (beats.length === 0) {
      const chunks = naiveSplitIntoBeats(narration, beatCount);
      return chunks.map((t) => ({
        caption: t,
        beat_text: t,
      }));
    }

    while (beats.length < beatCount) {
      beats.push(beats[beats.length - 1]);
    }
    if (beats.length > beatCount) beats.length = beatCount;

    return beats;
  } catch (err) {
    console.error('[BEAT_PLAN] Exception', err);
    const chunks = naiveSplitIntoBeats(narration, beatCount);
    return chunks.map((t) => ({ caption: t, beat_text: t }));
  }
}

/**
 * Call Stability's image API for a single prompt.
 * Uses style_preset = "digital-art" for cartoon/illustrated look.
 */
async function generateStabilityImageBuffer(
  prompt,
  { aspectRatio = '9:16', artStyle = '' } = {}
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

  // Cartoon illustration style
  form.append('style_preset', 'digital-art');

  const negativePrompt =
    'photorealistic, realism, realistic photo, 3d render, selfie, portrait, ' +
    'instagram style, pretty girl, cute anime girl, schoolgirl, influencer, ' +
    'fashion pose, glamour shot, close-up face, beauty shot, model, ' +
    'comic panels, manga panels, text, subtitles, watermark, logo, UI elements';

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
 */
async function generateStabilityImageUrlsForBeats({
  beatCount,
  beatTexts,
  artStyle,
  aspectRatio,
}) {
  const urls = [];

  for (let i = 1; i <= beatCount; i++) {
    const beatText = beatTexts[i - 1] || beatTexts[beatTexts.length - 1] || '';
    const prompt = buildScenePrompt({
      beatText,
      artStyle,
      sceneIndex: i,
      aspectRatio,
    });

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
      urls.push(null);
    }
  }

  // If Beat 1 is null but later beats have images, reuse one
  if (!urls[0]) {
    const fallback = urls.find((u) => !!u);
    if (fallback) {
      console.warn(
        '[STABILITY] Beat 1 had no image, reusing a later beat as fallback.'
      );
      urls[0] = fallback;
    }
  }

  return urls;
}

/**
 * Build a sequence of animation variants for all beats
 * so that no two consecutive beats use the same variant.
 */
function buildVariantSequence(count) {
  const seq = [];
  let last = null;

  for (let i = 0; i < count; i++) {
    const available = ANIMATION_VARIANTS.filter((v) => v !== last);
    const idx = i % available.length;
    const chosen = available[idx];
    seq.push(chosen);
    last = chosen;
  }

  return seq;
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
      artStyle = 'Scary toon', // Webflow UI can override
      language = 'English',
      voice = 'Adam',
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90', // "30-60" or "60-90"
      voice_url = null,        // future: ElevenLabs etc.
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

    // 3) Dynamically decide how many *unique* beats to use, based on targetSec
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

    // 4) Build visual beat plan (OpenAI or naive fallback)
    const beatPlan = await buildVisualBeatPlan({
      narration,
      storyType,
      artStyle,
      beatCount,
    });

    const beatTexts = beatPlan.map((b) => b.beat_text || '');
    const beatCaptions = beatPlan.map((b) => b.caption || '');

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

    // 6) Build animation variant sequence (no same variant twice in a row)
    const variantSequence = buildVariantSequence(beatCount);

    // 7) Build Creatomate modifications
    const mods = {
      Narration: narration,
      Voiceover: narration,
      VoiceLabel: voice,
      LanguageLabel: language,
      StoryTypeLabel: storyType,
      ...(voice_url ? { voice_url } : {}),
    };

    const style = artStyle || 'Scary toon';

    for (let i = 1; i <= MAX_BEATS; i++) {
      if (i <= beatCount) {
        const idx = i - 1;
        const beatText = beatTexts[idx] || '';
        const captionRaw = beatCaptions[idx] || beatText || `Scene ${i}`;
        const caption =
          captionRaw.length > 120
            ? captionRaw.slice(0, 117) + '…'
            : captionRaw;

        mods[`Beat${i}_Caption`] = caption;

        let imageUrl = null;

        if (IMAGE_PROVIDER === 'stability' && stabilityImageUrls.length > 0) {
          imageUrl = stabilityImageUrls[idx] || null;
        } else if (IMAGE_PROVIDER === 'dalle') {
          imageUrl = buildScenePrompt({
            beatText,
            artStyle: style,
            sceneIndex: i,
            aspectRatio,
          });
        }

        const chosenVariant = variantSequence[idx];

// 🔴 DEBUG: force a known test image on ALL Beat 1 variants
    if (i === 1) {
      imageUrl = 'https://fastly.picsum.photos/id/58/1080/1920.jpg?hmac=8J4PIXvrOV0f9b4pTovFKCer4tWyjZelIbWe415oOMk';
      console.log('[DEBUG_BEAT1_FORCE]', { imageUrl });
    }
        
        for (const variant of ANIMATION_VARIANTS) {
          const imgKey = `Beat${i}_${variant}_Image`;

          // ✅ Always keep PanLeft filled as a safety net,
          // and also fill the chosen variant.
          if ((variant === chosenVariant || variant === 'PanLeft') && imageUrl) {
            mods[imgKey] = imageUrl;
          } else {
            mods[imgKey] = null;
          }
        }

        if (i === 1) {
          console.log('[DEBUG_BEAT1]', {
            chosenVariant,
            imageUrlPresent: !!imageUrl,
            keysSet: ANIMATION_VARIANTS.map((v) => ({
              key: `Beat1_${v}_Image`,
              value:
                (v === chosenVariant || v === 'PanLeft') && imageUrl
                  ? '[URL]'
                  : 'null',
            })),
          });
        }
      } else {
        // i > beatCount -> explicitly clear everything for this beat
        mods[`Beat${i}_Caption`] = '';
        for (const variant of ANIMATION_VARIANTS) {
          const imgKey = `Beat${i}_${variant}_Image`;
          mods[imgKey] = null;
        }
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
      MIN_BEATS,
      MAX_BEATS,
      imageProvider: IMAGE_PROVIDER,
      stabilityImagesGenerated: stabilityImageUrls.length,
    });

    // 8) Call Creatomate
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
