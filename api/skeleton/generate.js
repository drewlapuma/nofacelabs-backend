const {
  calculateSkeletonCredits,
  VIDEO_DURATION_OPTIONS,
  VIDEO_RESOLUTION_OPTIONS,
} = require("../../lib/skeleton-credits");
const {
  createJob,
  updateJob,
  makeId,
} = require("../../lib/skeleton-jobs");
const {
  buildSkeletonRenderScript,
  createCreatomateRender,
  pollCreatomateRender,
} = require("../../lib/skeleton-creatomate");

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

function getPlaceholderSceneClips({
  estimatedSceneCount,
  animationDuration,
}) {
  const count = Math.max(1, Number(estimatedSceneCount) || 1);
  const dur = Math.max(0.1, Number(animationDuration) || 4);

  // Replace these with your real generated scene video URLs later.
  const placeholderClipUrl =
    process.env.SKELETON_PLACEHOLDER_SCENE_VIDEO_URL ||
    "https://samplelib.com/lib/preview/mp4/sample-5s.mp4";

  return Array.from({ length: count }).map((_, i) => ({
    url: placeholderClipUrl,
    duration: dur,
    index: i + 1,
  }));
}

function getPlaceholderNarrationAudioUrl() {
  return (
    process.env.SKELETON_PLACEHOLDER_NARRATION_AUDIO_URL ||
    "https://samplelib.com/lib/preview/mp3/sample-3s.mp3"
  );
}

function getLibraryMusicUrl(musicId) {
  const map = {
    "track-01": process.env.SKELETON_MUSIC_TRACK_01_URL || "",
    "track-02": process.env.SKELETON_MUSIC_TRACK_02_URL || "",
    "track-03": process.env.SKELETON_MUSIC_TRACK_03_URL || "",
    "track-04": process.env.SKELETON_MUSIC_TRACK_04_URL || "",
    "track-05": process.env.SKELETON_MUSIC_TRACK_05_URL || "",
    "track-06": process.env.SKELETON_MUSIC_TRACK_06_URL || "",
  };

  return map[String(musicId || "")] || "";
}

function getPlaceholderCaptionSegments(totalDuration, script) {
  const text = String(script || "").trim();
  if (!text) return [];

  const chunks = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!chunks.length) return [];

  const segDuration = Math.max(1, totalDuration / chunks.length);
  let cursor = 0;

  return chunks.map((chunk) => {
    const start = cursor;
    const end = Math.min(totalDuration, cursor + segDuration);
    cursor = end;
    return { text: chunk, start, end };
  });
}

async function runSkeletonJob(job) {
  const input = job.input || {};

  await updateJob(job.id, {
    status: "generating_voice",
    progress: 18,
    current_step: "Generating voice",
  });

  // Placeholder narration for now. Replace with real TTS next.
  const narrationAudioUrl = getPlaceholderNarrationAudioUrl();

  await updateJob(job.id, {
    status: "planning_scenes",
    progress: 34,
    current_step: "Planning scenes",
    output: {
      ...(job.output || {}),
      narration_audio_url: narrationAudioUrl,
    },
  });

  const sceneClips = getPlaceholderSceneClips({
    estimatedSceneCount: job.credits?.estimatedSceneCount,
    animationDuration: input.animationDuration,
  });

  await updateJob(job.id, {
    status: "animating_scenes",
    progress: 62,
    current_step: "Preparing clips for final render",
    output: {
      ...(job.output || {}),
      narration_audio_url: narrationAudioUrl,
      scene_clips: sceneClips,
    },
  });

  const totalDuration = sceneClips.reduce((sum, clip) => sum + Number(clip.duration || 0), 0);
  const captionSegments = input.captionsEnabled
    ? getPlaceholderCaptionSegments(totalDuration, input.script)
    : [];

  const musicUrl =
    input.musicType === "library"
      ? getLibraryMusicUrl(input.musicId)
      : "";

  const renderScript = buildSkeletonRenderScript({
    sceneClips,
    narrationAudioUrl,
    musicUrl,
    musicVolume: input.musicVolume,
    captionSegments,
    captionStyle: input.captionStyle,
    captionSettings: input.captionSettings || {},
    resolution: input.resolution,
  });

  await updateJob(job.id, {
    status: "rendering_final",
    progress: 82,
    current_step: "Submitting Creatomate render",
    output: {
      ...(job.output || {}),
      narration_audio_url: narrationAudioUrl,
      scene_clips: sceneClips,
      caption_segments: captionSegments,
      render_script: renderScript,
    },
  });

  const creatomateRender = await createCreatomateRender(renderScript);
  const creatomateRenderId = creatomateRender?.id;

  await updateJob(job.id, {
    status: "rendering_final",
    progress: 88,
    current_step: "Waiting for Creatomate render",
    output: {
      ...(job.output || {}),
      narration_audio_url: narrationAudioUrl,
      scene_clips: sceneClips,
      caption_segments: captionSegments,
      creatomate_render_id: creatomateRenderId || "",
    },
  });

  const finalRender = await pollCreatomateRender(creatomateRenderId);

  await updateJob(job.id, {
    status: "completed",
    progress: 100,
    current_step: "Completed",
    output: {
      ...(job.output || {}),
      narration_audio_url: narrationAudioUrl,
      scene_clips: sceneClips,
      caption_segments: captionSegments,
      creatomate_render_id: creatomateRenderId || "",
      final_video_url: finalRender?.url || finalRender?.download_url || "",
      video_url: finalRender?.url || finalRender?.download_url || "",
      thumbnail_url:
        finalRender?.snapshot_url ||
        finalRender?.thumbnail_url ||
        "",
      creatomate_render: finalRender,
    },
  });
}

module.exports = async function handler(req, res) {
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
      progress: 6,
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

    // Fire and forget so API returns immediately.
    runSkeletonJob(job).catch(async (err) => {
      console.error("[api/skeleton/generate] background job failed", err);
      try {
        await updateJob(job.id, {
          status: "failed",
          progress: job.progress || 0,
          current_step: "Failed",
          error_message: err.message || "Skeleton generation failed",
        });
      } catch (updateErr) {
        console.error("[api/skeleton/generate] failed to mark job failed", updateErr);
      }
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
