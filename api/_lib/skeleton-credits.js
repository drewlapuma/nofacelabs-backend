const IMAGE_CREDIT_MAP = {
  "nano-banana": 2,
  "imagen-4-fast": 3,
  "flux-2-flex": 4,
  "imagen-4": 5,
  "flux-2": 5,
  "nano-banana-pro": 6,
  "flux-2-pro": 7,
  "imagen-4-ultra": 8,
  "flux-2-max": 10,
};

const VIDEO_BASE_CREDIT_MAP = {
  "sora-2": 15,
  "sora-2-pro": 55,
  "veo-3-fast": 30,
  "veo-3-1-fast": 30,
  "veo-3": 75,
  "veo-3-1": 75,
  "grok-imagine-video": 80,
};

const VIDEO_DURATION_OPTIONS = {
  "veo-3-1": [4, 6, 8],
  "veo-3-1-fast": [4, 6, 8],
  "veo-3": [4, 6, 8],
  "veo-3-fast": [4, 6, 8],
  "sora-2": [4, 8, 12],
  "sora-2-pro": [4, 8, 12],
  "grok-imagine-video": [6, 10],
};

const VIDEO_RESOLUTION_OPTIONS = {
  "veo-3-1": ["720p", "1080p"],
  "veo-3-1-fast": ["720p", "1080p"],
  "veo-3": ["720p", "1080p"],
  "veo-3-fast": ["720p", "1080p"],
  "sora-2": ["720p", "1080p"],
  "sora-2-pro": ["720p", "1080p"],
  "grok-imagine-video": ["480p", "720p"],
};

const VIDEO_DURATION_MULT = {
  4: 1.0,
  6: 1.2,
  8: 1.6,
  10: 2.0,
  12: 2.3,
};

const RESOLUTION_MULT = {
  "480p": 0.8,
  "720p": 1.0,
  "1080p": 1.5,
};

function getWordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function estimateDurationSec(script, voiceSpeed = 1) {
  const text = String(script || "").trim();
  if (!text) return 0;

  const chars = text.replace(/\s/g, "").length;
  const words = getWordCount(text);
  const speed = Number(voiceSpeed) || 1;

  const wordBasedSec = words > 0
    ? Math.round((words / (150 * speed)) * 60)
    : 0;

  const charBasedSec = Math.round(chars / (12 * speed));
  const useCharBased = words <= 2 || chars / Math.max(words, 1) > 12;

  return Math.max(3, useCharBased ? charBasedSec : wordBasedSec);
}

function estimateSceneCount(script, durationSec) {
  const rawText = String(script || "").trim();
  const chars = rawText.replace(/\s/g, "").length;

  if (!rawText) return 0;
  if (!durationSec) return Math.max(1, Math.ceil(chars / 120));

  return Math.max(1, Math.ceil(durationSec / 4));
}

function validateVideoOptions(videoModel, animationDuration, resolution) {
  const allowedDurations = VIDEO_DURATION_OPTIONS[videoModel] || [];
  const allowedResolutions = VIDEO_RESOLUTION_OPTIONS[videoModel] || [];

  if (!allowedDurations.includes(Number(animationDuration))) {
    throw new Error(`Unsupported animationDuration ${animationDuration} for ${videoModel}`);
  }

  if (!allowedResolutions.includes(String(resolution))) {
    throw new Error(`Unsupported resolution ${resolution} for ${videoModel}`);
  }
}

function calculateSkeletonCredits({
  script,
  imageModel,
  videoModel,
  animationDuration,
  resolution,
  voiceSpeed = 1,
}) {
  const durationSec = estimateDurationSec(script, voiceSpeed);
  const scenes = estimateSceneCount(script, durationSec);

  const imageRate = IMAGE_CREDIT_MAP[imageModel];
  const videoBase = VIDEO_BASE_CREDIT_MAP[videoModel];
  const durationMult = VIDEO_DURATION_MULT[Number(animationDuration)];
  const resolutionMult = RESOLUTION_MULT[String(resolution)];

  if (imageRate == null) throw new Error(`Unsupported imageModel: ${imageModel}`);
  if (videoBase == null) throw new Error(`Unsupported videoModel: ${videoModel}`);
  if (durationMult == null) throw new Error(`Unsupported animationDuration: ${animationDuration}`);
  if (resolutionMult == null) throw new Error(`Unsupported resolution: ${resolution}`);

  validateVideoOptions(videoModel, animationDuration, resolution);

  const imageCost = imageRate * scenes;
  const animationCost = Math.ceil(videoBase * durationMult * resolutionMult) * scenes;
  const voiceCost = scenes ? Math.max(6, Math.round(durationSec / 10)) : 0;
  const total = imageCost + animationCost + voiceCost;

  return {
    estimatedDurationSec: durationSec,
    estimatedSceneCount: scenes,
    imageCost,
    animationCost,
    voiceCost,
    totalCost: total,
  };
}

module.exports = {
  IMAGE_CREDIT_MAP,
  VIDEO_BASE_CREDIT_MAP,
  VIDEO_DURATION_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
  VIDEO_DURATION_MULT,
  RESOLUTION_MULT,
  estimateDurationSec,
  estimateSceneCount,
  validateVideoOptions,
  calculateSkeletonCredits,
};
