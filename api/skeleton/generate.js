const {
  calculateSkeletonCredits,
  VIDEO_DURATION_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} = require("../_lib/skeleton-credits");
const {
  createJob,
  makeId,
} = require("../_lib/skeleton-jobs");

function setCors(req, res) {
  const allowedOrigins = [
    "https://nofacelabsai.webflow.io",
    "https://nofacelabs.ai",
    "http://localhost:3000",
  ];

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-nf-member-id, x-nf-member-email"
  );
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getUserId(req) {
  return (
    req.headers["x-nf-member-id"] ||
    req.headers["x-member-id"] ||
    req.headers["x-user-id"] ||
    null
  );
}

function getTitleFromScript(script) {
  const firstLine = String(script || "").trim().split("\n")[0] || "";
  const clean = firstLine.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 80) : "Untitled Skeleton Video";
}

function validateBody(body) {
  const required = [
    "script",
    "imageModel",
    "videoModel",
    "animationDuration",
    "resolution",
  ];

  for (const key of required) {
    if (
      body[key] == null ||
      (typeof body[key] === "string" && !body[key].trim())
    ) {
      throw new Error(`Missing required field: ${key}`);
    }
  }

  const script = String(body.script || "").trim();
  if (script.length < 10) {
    throw new Error("Script is too short");
  }

  const videoModel = String(body.videoModel);
  const duration = Number(body.animationDuration);
  const resolution = String(body.resolution);

  const validDurations = VIDEO_DURATION_OPTIONS[videoModel] || [];
  const validResolutions = VIDEO_RESOLUTION_OPTIONS[videoModel] || [];

  if (!validDurations.includes(duration)) {
    throw new Error(`Invalid duration ${duration} for ${videoModel}`);
  }

  if (!validResolutions.includes(resolution)) {
    throw new Error(`Invalid resolution ${resolution} for ${videoModel}`);
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method !== "POST") {
      return send(res, 405, { error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    validateBody(body);

    const userId = getUserId(req);
    const title = getTitleFromScript(body.script);

    const credits = calculateSkeletonCredits({
      script: body.script,
      imageModel: body.imageModel,
      videoModel: body.videoModel,
      animationDuration: Number(body.animationDuration),
      resolution: body.resolution,
      voiceSpeed: Number(body.voiceSpeed || 1),
    });

    const job = await createJob({
      id: makeId(),
      user_id: userId,
      title,
      status: "queued",
      progress: 5,
      current_step: "Queued",
      script: body.script,
      input: {
        script: body.script,
        imageModel: body.imageModel,
        videoModel: body.videoModel,
        animationDuration: Number(body.animationDuration),
        resolution: body.resolution,
        voiceId: body.voiceId || "",
        voiceSpeed: Number(body.voiceSpeed || 1),
        voicePitch: Number(body.voicePitch || 1),
        captionsEnabled: !!body.captionsEnabled,
        captionStyle: body.captionStyle || "",
        captionSettings: body.captionSettings || {},
        musicType: body.musicType || "library",
        musicId: body.musicId || "",
        musicVolume: Number(body.musicVolume || 28),
        musicUploadName: body.musicUploadName || "",
      },
      credits,
      output: {},
    });

    return send(res, 200, {
      ok: true,
      jobId: job.id,
      job,
    });
  } catch (error) {
    console.error("[api/skeleton/generate] error", error);
    return send(res, 400, {
      ok: false,
      error: error.message || "Failed to create skeleton generation job",
    });
  }
};
