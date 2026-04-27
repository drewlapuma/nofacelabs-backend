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

function buildCaptionElements({
  captionSegments = [],
  captionSettings = {},
}) {
  if (!captionSegments.length) return [];

  const fontFamily = captionSettings.fontFamily || "Inter";
  const fontSize = safeNumber(captionSettings.fontSize, 48);
  const fillColor = captionSettings.fillColor || "#ffffff";
  const strokeColor = captionSettings.strokeColor || "#000000";
  const strokeWidth = safeNumber(captionSettings.strokeWidth, 0);
  const x = safeNumber(captionSettings.x, 50);
  const y = safeNumber(captionSettings.y, 85);

  return captionSegments.map((seg, index) => ({
    id: `caption_${index + 1}`,
    type: "text",
    text: String(seg.text || ""),
    track: 10,
    time: safeNumber(seg.start, 0),
    duration: Math.max(0.1, safeNumber(seg.end, 0) - safeNumber(seg.start, 0)),
    x: `${x}%`,
    y: `${y}%`,
    width: "86%",
    height: "auto",
    font_family: fontFamily,
    font_size: fontSize,
    fill_color: fillColor,
    stroke_color: strokeColor,
    stroke_width: strokeWidth,
    text_align: "center",
    vertical_align: "middle",
    background_color: "transparent",
  }));
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
  captionSettings = {},
  resolution = "720p",
}) {
  const sceneElements = buildSceneVideoElements(sceneClips);
  const totalDuration = sceneClips.reduce(
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
      captionSettings,
    })
  );

  const outputWidth = resolution === "1080p" ? 1080 : resolution === "480p" ? 480 : 720;
  const outputHeight = resolution === "1080p" ? 1920 : resolution === "480p" ? 854 : 1280;

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
  const response = await fetch(`${CREATOMATE_API_BASE}/renders/${encodeURIComponent(renderId)}`, {
    method: "GET",
    headers: getCreatomateHeaders(),
  });

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
