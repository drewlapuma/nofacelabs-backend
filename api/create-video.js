// api/create-video.js  (CommonJS, Node 18)
const https = require('https');

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const IMAGE_PROVIDER = (process.env.IMAGE_PROVIDER || 'krea').toLowerCase();

// Krea config
const KREA_API_KEY = process.env.KREA_API_KEY;
const KREA_API_URL =
  process.env.KREA_API_URL || 'https://api.krea.ai/v1/images'; // <-- adjust to real endpoint if different

// Beat / timing settings
const MIN_BEATS = 8;           // never fewer than this
const MAX_BEATS = 24;          // must match how many Beat groups your template supports
const SECONDS_PER_BEAT = 3.0;  // approx seconds per scene (your beats are 3s in Creatomate)

// Animation variants in your Creatomate template
const ANIMATION_VARIANTS = ['PanRight', 'PanLeft', 'PanUp', 'PanDown', 'Zoom'];

// ----------------- STYLE REGISTRY -----------------
const STYLE_REGISTRY = {
  creepy_toon: {
    provider: 'krea',
    style_id: 'tvjlqsab9',
    negative_prompt:
      'photorealistic, realistic skin, hyperreal, 3d render, CGI, glossy, ultra-detailed, ' +
      'anime, manga, selfie, portrait, pretty girl, text, subtitles, watermark, logo, UI, border',
  },
  // keep scary_toon as prompt-driven (no style_id) unless you later add one
  scary_toon: {
    provider: 'krea',
    style_id: null,
    negative_prompt:
      'gore, graphic violence, realistic blood, photorealistic, realistic skin, hyperreal, ' +
      '3d render, CGI, selfie, portrait, pretty girl, text, subtitles, watermark, logo, UI, border',
  },
};

function normalizeStyleKey(artStyle, styleKey) {
  const k = (styleKey || '').trim().toLowerCase();
  if (k) return k;

  const s = (artStyle || '').trim().toLowerCase();
  if (s.includes('creepy')) return 'creepy_toon';
  if (s.includes('scary') && s.includes('toon')) return 'scary_toon';
  if (s.includes('toon') && s.includes('scary')) return 'scary_toon';
  if (s.includes('toon')) return 'scary_toon'; // default toon bucket
  return 'scary_toon';
}

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

  if (beats.length > beatCount) {
    beats.length = beatCount;
  }

  while (beats.length < beatCount) {
    beats.push(beats[beats.length - 1] || text);
  }

  return beats;
}

/**
 * Build a visual prompt for a scene, based on the beat text + styleKey/artStyle.
 */
function buildScenePrompt({ beatText, artStyle, sceneIndex, aspectRatio, styleKey }) {
  const ratioText =
    aspectRatio === '9:16'
      ? 'vertical 9:16 composition'
      : aspectRatio === '1:1'
      ? 'square 1:1 composition'
      : 'horizontal 16:9 composition';

  // Default base rules (keep these!)
  const globalRules =
    'no text, no subtitles, no user interface, no watermarks, no logos, no borders, single scene only, no comic panels, no multiple frames.';

  let styleChunk = '';

  // Creepy Toon (your tvjlqsab9 cover vibe: simple/dark/cartoon, not gothic, not anime)
  if (styleKey === 'creepy_toon') {
    styleChunk =
      'Creepy toon cartoon storytelling illustration: clean bold outlines, flat colors with soft cel shading, ' +
      'simple shapes, slightly eerie vibe, dark nighttime palette (deep blues/greens), subtle grain texture, ' +
      'minimal background detail, strong silhouette readability, playful-spooky but family-friendly, ' +
      'cinematic framing, crisp edges, 2D digital illustration. ' +
      'No anime look, no manga look, not photorealistic, not 3D.';
  }
  // Scary toon (your existing TikTok horror cartoon spec)
  else {
    const styleRaw = (artStyle || '').toLowerCase();
    if (styleRaw.includes('scary') || styleRaw.includes('toon')) {
      styleChunk =
        'Cartoon storytelling illustration in the style of viral TikTok horror story animations: ' +
        'clean bold outlines, soft cel-shading, smooth gradients, expressive characters, ' +
        'light anime influence, high contrast lighting, slightly exaggerated proportions, ' +
        'cinematic framing, vibrant but not neon colors, simple textured backgrounds, ' +
        'smooth line art, crisp edges, digital painting, storybook vibe, ' +
        'no comic panels, no multiple frames, single scene only. ' +
        'Darker mood with spooky atmosphere, still family-friendly, no gore or graphic violence, ' +
        'no photorealistic faces, no pretty girls, no selfies, no portraits.';
    } else {
      styleChunk =
        '2d digital cartoon storytelling illustration, flat colors with soft shading, ' +
        'clean bold outlines, expressive characters, light anime influence, cinematic framing, ' +
        'vibrant but not neon colors, simple textured backgrounds, smooth line art, crisp edges, ' +
        'digital painting, storybook vibe, no comic panels, no multiple frames, single scene only.';
    }
  }

  return `
Scene ${sceneIndex} from a narrated TikTok story.

Narration for this scene:
"${beatText}"

Visual style: ${styleChunk}, ${ratioText}. ${globalRules}
`.trim();
}

/**
 * Call Krea's image API for a single prompt and return an image URL.
 * Supports optional style_id + negative_prompt.
 * NOTE: Adjust payload/response parsing to match Krea docs if needed.
 */
async function generateKreaImageUrl(
  prompt,
  { aspectRatio = '9:16', style_id = null, negative_prompt = null } = {}
) {
  if (!KREA_API_KEY) {
    throw new Error('KREA_API_KEY not set');
  }

  const payload = {
    prompt,
    aspect_ratio:
      aspectRatio === '9:16'
        ? '9:16'
        : aspectRatio === '1:1'
        ? '1:1'
        : '16:9',
  };

  // ✅ Plug in Krea style + negatives when we have them
  if (style_id) payload.style_id = style_id;
  if (negative_prompt) payload.negative_prompt = negative_prompt;

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
  artStyle,
  aspectRatio,
  styleKey,
  styleIdOverride = null,
}) {
  const urls = [];

  // Resolve style settings
  const reg = STYLE_REGISTRY[styleKey] || {};
  const style_id = styleIdOverride || reg.style_id || null;
  const negative_prompt = reg.negative_prompt || null;

  for (let i = 1; i <= beatCount; i++) {
    const beatText =
      beatTexts[i - 1] || beatTexts[beatTexts.length - 1] || '';

    const prompt = buildScenePrompt({
      beatText,
      artStyle,
      sceneIndex: i,
      aspectRatio,
      styleKey,
    });

    console.log('================ PROMPT_BEAT_%d ================', i);
    console.log(prompt);
    console.log('=================================================');

    try {
      console.log(`[KREA] Generating image for Beat ${i}/${beatCount}`, {
        styleKey,
        style_id: style_id || '(none)',
      });

      const url = await generateKreaImageUrl(prompt, {
        aspectRatio,
        style_id,
        negative_prompt,
      });

      urls.push(url);
    } catch (err) {
      console.error(
        `[KREA] Beat ${i} failed, leaving this beat without an image`,
        err
      );
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
    const idx = i % available.length;
    const chosen = available[idx];

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

  const voiceUrl = data.voiceUrl;
  const captions = Array.isArray(data.captions) ? data.captions : [];

  return { voiceUrl, captions };
}

// ----------------- MAIN HANDLER -----------------
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
      artStyle = 'Scary toon',
      language = 'English',
      voice = 'Adam',
      aspectRatio = '9:16',
      customPrompt = '',
      durationRange = '60-90',
      voice_url = null,

      // ✅ NEW:
      // styleKey: "creepy_toon" (recommended) or "scary_toon"
      // styleId: "tvjlqsab9" (optional override)
      styleKey = '',
      styleId = '',
    } = body;

    if (!process.env.CREATOMATE_API_KEY) {
      return res
        .status(500)
        .json({ error: 'MISSING_CREATOMATE_API_KEY' });
    }

    // Resolve style key + style settings
    const resolvedStyleKey = normalizeStyleKey(artStyle, styleKey);
    const styleIdOverride = (styleId || '').trim() || null;

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
      resolvedStyleKey,
      styleIdOverride: styleIdOverride || '(none)',
    });

    const narration = (scriptResp && scriptResp.narration) || '';
    if (!narration.trim()) {
      console.error('[CREATE_VIDEO] SCRIPT_EMPTY', scriptResp);
      return res
        .status(502)
        .json({ error: 'SCRIPT_EMPTY', details: scriptResp });
    }

    // 2) Generate voice + precise captions
    let voiceUrl = null;
    let captions = [];
    try {
      const vc = await getVoiceAndCaptions(baseUrl, narration, language);
      voiceUrl = vc.voiceUrl;
      captions = vc.captions || [];
    } catch (e) {
      console.error(
        '[CREATE_VIDEO] getVoiceAndCaptions failed, continuing without captions',
        e
      );
    }

    // 3) Estimate narration time & decide beats
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

    // 4) Build beatTexts
    const beatTexts = splitNarrationIntoBeats(narration, beatCount);

    // 5) Generate Krea images
    let imageUrls = [];
    if (IMAGE_PROVIDER === 'krea') {
      try {
        imageUrls = await generateKreaImageUrlsForBeats({
          beatCount,
          beatTexts,
          artStyle,
          aspectRatio,
          styleKey: resolvedStyleKey,
          styleIdOverride,
        });
      } catch (err) {
        console.error(
          '[CREATE_VIDEO] KREA_BATCH_FAILED, falling back to prompts only',
          err
        );
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

      // helpful debug labels (optional—safe even if template ignores)
      StyleKeyLabel: resolvedStyleKey,
      StyleIdLabel: styleIdOverride || (STYLE_REGISTRY[resolvedStyleKey]?.style_id || ''),
    };

    if (voiceUrl) {
      mods.VoiceUrl = voiceUrl;
      if (captions.length) {
        mods['Captions_JSON.text'] = JSON.stringify(captions);
      }
    }

    if (voice_url) {
      mods.voice_url = voice_url;
    }

    const style = artStyle || 'Scary toon';

    // Fill beats
    for (let i = 1; i <= beatCount; i++) {
      const beatText = beatTexts[i - 1] || '';
      let imageUrl = null;

      if (IMAGE_PROVIDER === 'krea' && imageUrls.length >= i) {
        imageUrl = imageUrls[i - 1] || null;
      } else if (IMAGE_PROVIDER === 'dalle') {
        imageUrl = buildScenePrompt({
          beatText,
          artStyle: style,
          sceneIndex: i,
          aspectRatio,
          styleKey: resolvedStyleKey,
        });
      }

      const chosenVariant = variantSequence[i - 1];

      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        if (variant === chosenVariant && imageUrl) {
          mods[imgKey] = imageUrl;
        } else {
          mods[imgKey] = null;
        }
      }
    }

    // Clear unused beats
    for (let i = beatCount + 1; i <= MAX_BEATS; i++) {
      for (const variant of ANIMATION_VARIANTS) {
        const imgKey = `Beat${i}_${variant}_Image`;
        mods[imgKey] = null;
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
      kreaImagesGenerated: imageUrls.length,
      hasVoiceUrl: !!mods.VoiceUrl,
      hasCaptionsJson: !!mods['Captions_JSON.text'],
      resolvedStyleKey,
      styleIdOverride: styleIdOverride || '(none)',
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
