const CREATOMATE_API_BASE = "https://api.creatomate.com/v2";

function getCreatomateApiKey() {
  return process.env.CREATOMATE_API_KEY || "";
}

function getCreatomateHeaders() {
  const apiKey = getCreatomateApiKey();

  if (!apiKey) {
    throw new Error("Missing CREATOMATE_API_KEY");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function safeNumber(n, fallback = 0) {
  const value = Number(n);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeCaptionStyle(style) {
  const s = String(style || "sentence").trim().toLowerCase();

  if (s === "karoke") return "karaoke";
  if (!s) return "sentence";

  return s;
}

function getCaptionPreset(style) {
  const s = normalizeCaptionStyle(style);

  const presets = {
    sentence: {
      font_family: "Inter",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 7.2,
      font_weight: "700",
      background_color: "transparent",
      text_transform: "none",
      y: 72,
    },

    word: {
      font_family: "Staatliches",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 8.1,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    boldwhite: {
      font_family: "Luckiest Guy",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 9.9,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    karaoke: {
      font_family: "The Bold Font",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 8.1,
      font_weight: "700",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    yellowpop: {
      font_family: "Komika Axis",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 10.8,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    minttag: {
      font_family: "Titan One",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 8.1,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    outlinepunch: {
      font_family: "Anton",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 11.7,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    blackbar: {
      font_family: "Poppins",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 0,
      font_weight: "700",
      background_color: "#000000",
      text_transform: "none",
      y: 72,
    },

    highlighter: {
      font_family: "Luckiest Guy",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 7.2,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    neonglow: {
      font_family: "Titan One",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 0,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    purplepop: {
      font_family: "Komika Axis",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 9,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    compactlowerthird: {
      font_family: "Inter",
      font_size: 46,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 0,
      font_weight: "700",
      background_color: "transparent",
      text_transform: "none",
      y: 84,
    },

    bouncepop: {
      font_family: "Luckiest Guy",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#333333",
      stroke_width: 7.2,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    redalert: {
      font_family: "Sigmar One",
      font_size: 48,
      fill_color: "#ff2d2d",
      stroke_color: "#000000",
      stroke_width: 11.7,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },

    redtag: {
      font_family: "Titan One",
      font_size: 48,
      fill_color: "#ffffff",
      stroke_color: "#000000",
      stroke_width: 8.1,
      font_weight: "400",
      background_color: "transparent",
      text_transform: "uppercase",
      y: 72,
    },
  };

  return presets[s] || presets.sentence;
}

function applyTextTransform(text, transform) {
  const value = String(text || "");
  const mode = String(transform || "none").toLowerCase();

  if (mode === "uppercase") return value.toUpperCase();
  if (mode === "lowercase") return value.toLowerCase();

  if (mode === "capitalize") {
    return value.replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return value;
}

function getCaptionAnimation(style) {
  const s = normalizeCaptionStyle(style);

  if (s === "bouncepop") {
    return "bounce";
  }

  if (s === "redalert") {
    return "shake";
  }

  return "none";
}

function buildCaptionElements({
  captionSegments = [],
  captionStyle = "",
  captionSettings = {},
}) {
  if (!captionSegments.length) return [];

  const style = normalizeCaptionStyle(captionStyle);
  const preset = getCaptionPreset(style);

  const fontFamily = captionSettings.fontFamily || preset.font_family;
  const fontSize = safeNumber(captionSettings.fontSize, preset.font_size || 48);
  const fillColor = captionSettings.fillColor || preset.fill_color || "#ffffff";
  const strokeColor = captionSettings.strokeColor || preset.stroke_color || "#000000";

  const strokeWidth = safeNumber(
    captionSettings.strokeWidth ?? preset.stroke_width,
    preset.stroke_width || 0
  );

  const x = safeNumber(captionSettings.x, 50);
  const y = safeNumber(captionSettings.y, preset.y || 72);

  const textTransform =
    captionSettings.textTransform ||
    preset.text_transform ||
    "none";

  const backgroundColor =
    style === "blackbar"
      ? captionSettings.backgroundColor || preset.background_color || "#000000"
      : preset.background_color || "transparent";

  const animation = getCaptionAnimation(style);

  return captionSegments.map((seg, index) => {
    const start = safeNumber(seg.start, 0);
    const end = safeNumber(seg.end, start + 1);
    const duration = Math.max(0.1, end - start);

    return {
      id: `caption_${index + 1}`,
      type: "text",
      text: applyTextTransform(String(seg.text || ""), textTransform),
      track: 10,
      time: start,
      duration,
      x: `${x}%`,
      y: `${y}%`,
      width: "86%",
      height: "auto",
      font_family: fontFamily,
      font_size: fontSize,
      fill_color: fillColor,
      stroke_color: strokeColor,
      stroke_width: strokeWidth,
      font_weight: preset.font_weight || "700",
      text_align: "center",
      vertical_align: "middle",
      background_color: backgroundColor,
      animation,
    };
  });
}

function buildSceneVideoElements(sceneClips = []) {
  let cursor = 0;

  return sceneClips.map((clip, index) => {
    const clipDuration = Math.max(0.1, safeNumber(clip.duration, 4));

    const element = {
      id: `scene_${index + 1}`,
      type: "video",
      source: clip.url,
      track: 1,
      time: cursor,
      duration: clipDuration,
      x: "50%",
      y: "50%",
      width: "100%",
      height: "100%",
      fit: "cover",

      // Generated scene videos should be visual-only.
      // ElevenLabs narration + optional background music are the only final audio.
      volume: `${Math.max(0, Math.min(40, safeNumber(clip.volume, 30)))}%`,
    };

    cursor += clipDuration;
    return element;
  });
}

function buildNarrationElement(narrationAudioUrl, totalDuration) {
  if (!narrationAudioUrl) return null;

  return {
    id: "narration_audio",
    type: "audio",
    source: narrationAudioUrl,
    track: 20,
    time: 0,
    duration: Math.max(0.1, safeNumber(totalDuration, 1)),
    volume: "100%",
  };
}

function buildMusicElement(musicUrl, totalDuration, musicVolume = 28) {
  if (!musicUrl) return null;

  return {
    id: "music_audio",
    type: "audio",
    source: musicUrl,
    track: 5,
    time: 0,
    duration: Math.max(0.1, safeNumber(totalDuration, 1)),
    volume: `${Math.max(0, Math.min(100, safeNumber(musicVolume, 28)))}%`,
  };
}

function buildSkeletonRenderScript({
  sceneClips = [],
  narrationAudioUrl = "",
  musicUrl = "",
  musicVolume = 28,
  captionSegments = [],
  captionStyle = "",
  captionSettings = {},
  resolution = "720p",
}) {
  const sceneElements = buildSceneVideoElements(sceneClips);

  const totalDuration =
    sceneClips.reduce(
      (sum, clip) => sum + Math.max(0.1, safeNumber(clip.duration, 4)),
      0
    ) || 4;

  const elements = [...sceneElements];

  const narrationElement = buildNarrationElement(narrationAudioUrl, totalDuration);
  if (narrationElement) elements.push(narrationElement);

  const musicElement = buildMusicElement(musicUrl, totalDuration, musicVolume);
  if (musicElement) elements.push(musicElement);

  elements.push(
    ...buildCaptionElements({
      captionSegments,
      captionStyle,
      captionSettings,
    })
  );

  const outputWidth =
    resolution === "1080p" ? 1080 :
    resolution === "480p" ? 480 :
    720;

  const outputHeight =
    resolution === "1080p" ? 1920 :
    resolution === "480p" ? 854 :
    1280;

  return {
    output_format: "mp4",
    width: outputWidth,
    height: outputHeight,
    elements,
  };
}

async function createCreatomateRender(renderScript) {
  const response = await fetch(`${CREATOMATE_API_BASE}/renders`, {
    method: "POST",
    headers: getCreatomateHeaders(),
    body: JSON.stringify(renderScript),
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error("[creatomate] create render failed", {
      status: response.status,
      body: data,
    });

    throw new Error(
      data?.message ||
      data?.error ||
      data?.raw ||
      `Creatomate render creation failed (${response.status})`
    );
  }

  if (Array.isArray(data)) return data[0];
  return data;
}

async function getCreatomateRenderStatus(renderId) {
  const response = await fetch(
    `${CREATOMATE_API_BASE}/renders/${encodeURIComponent(renderId)}`,
    {
      method: "GET",
      headers: getCreatomateHeaders(),
    }
  );

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    console.error("[creatomate] get render status failed", {
      status: response.status,
      body: data,
    });

    throw new Error(
      data?.message ||
      data?.error ||
      data?.raw ||
      `Creatomate status request failed (${response.status})`
    );
  }

  return data;
}

module.exports = {
  buildSkeletonRenderScript,
  createCreatomateRender,
  getCreatomateRenderStatus,
};
