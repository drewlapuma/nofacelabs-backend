const { generateVoiceAudio } = require("../_lib/skeleton-voice");
const { getJobById, updateJob } = require("../_lib/skeleton-jobs");
const { planScenes } = require("../_lib/skeleton-scenes");
const { generateSceneImages } = require("../_lib/skeleton-images");
const { generateSceneVideos } = require("../_lib/skeleton-video");
const {
  buildSkeletonRenderScript,
  createCreatomateRender,
  getCreatomateRenderStatus,
} = require("../_lib/skeleton-creatomate");

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

function getMemberId(job) {
  return job.user_id || job.member_id || job.input?.memberId || "anonymous";
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

function getCaptionSegments(totalDuration, script) {
  const text = String(script || "").trim();
  if (!text) return [];

  const chunks = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);

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

function normalizeSceneClips(scenesWithVideos, input) {
  const duration = Number(input.animationDuration || input.duration || 4);

  return scenesWithVideos
    .map((scene, index) => ({
      url: scene.videoUrl || scene.clipUrl || scene.downloadUrl || "",
      duration,
      index: index + 1,
      imageUrl: scene.imageUrl || "",
      prompt: scene.videoPrompt || scene.imagePrompt || "",
    }))
    .filter((clip) => clip.url);
}

async function advanceJob(job) {
  const input = job.input || {};
  const output = job.output || {};
  const memberId = getMemberId(job);

  if (job.status === "queued") {
    const voice = await generateVoiceAudio({
      text: input.script || job.script,
      voiceId: input.voiceId || undefined,
      speed: input.voiceSpeed || 1,
      jobId: job.id,
    });

    return updateJob(job.id, {
      status: "generating_voice",
      progress: 20,
      current_step: "Voice generated",
      output: {
        ...output,
        narration_audio_url: voice.url,
        narration_audio_path: voice.path || "",
      },
    });
  }

  if (job.status === "generating_voice") {
    const plannedScenes = planScenes(input.script || job.script);

    return updateJob(job.id, {
      status: "planning_scenes",
      progress: 32,
      current_step: "Scenes planned",
      output: {
        ...output,
        planned_scenes: plannedScenes,
      },
    });
  }

  if (job.status === "planning_scenes") {
    const plannedScenes = output.planned_scenes || planScenes(input.script || job.script);

    const scenesWithImages = await generateSceneImages({
      scenes: plannedScenes,
      model: input.imageModel || "imagen-4",
      memberId,
    });

    return updateJob(job.id, {
      status: "generating_images",
      progress: 50,
      current_step: "Scene images generated",
      output: {
        ...output,
        planned_scenes: plannedScenes,
        scenes_with_images: scenesWithImages,
      },
    });
  }

  if (job.status === "generating_images") {
    const scenesWithImages = output.scenes_with_images || [];

    if (!scenesWithImages.length) {
      return updateJob(job.id, {
        status: "failed",
        current_step: "Failed",
        error_message: "No generated scene images found",
      });
    }

    const scenesWithVideos = await generateSceneVideos({
      scenes: scenesWithImages,
      model: input.videoModel || "veo-3-1",
      duration: input.animationDuration || 4,
      resolution: input.resolution || "720p",
      memberId,
    });

    return updateJob(job.id, {
      status: "animating_scenes",
      progress: 68,
      current_step: "Scene animations started",
      output: {
        ...output,
        scenes_with_videos: scenesWithVideos,
      },
    });
  }

  if (job.status === "animating_scenes") {
    const sceneClips = normalizeSceneClips(output.scenes_with_videos || [], input);

    if (!sceneClips.length) {
      return updateJob(job.id, {
        status: "failed",
        current_step: "Failed",
        error_message:
          "No completed scene video URLs found yet. Video polling needs to return final URLs before Creatomate can render.",
      });
    }

    const totalDuration = sceneClips.reduce(
      (sum, clip) => sum + Number(clip.duration || 0),
      0
    );

    const captionSegments = input.captionsEnabled
      ? getCaptionSegments(totalDuration, input.script || job.script)
      : [];

    const musicUrl =
      input.musicType === "library"
        ? getLibraryMusicUrl(input.musicId)
        : "";

    const renderScript = buildSkeletonRenderScript({
      sceneClips,
      narrationAudioUrl: output.narration_audio_url || "",
      musicUrl,
      musicVolume: input.musicVolume,
      captionSegments,
      captionStyle: input.captionStyle,
      captionSettings: input.captionSettings || {},
      resolution: input.resolution,
    });

    const creatomateRender = await createCreatomateRender(renderScript);
    const creatomateRenderId = creatomateRender?.id || "";

    return updateJob(job.id, {
      status: "rendering_final",
      progress: 84,
      current_step: "Waiting for Creatomate render",
      output: {
        ...output,
        scene_clips: sceneClips,
        caption_segments: captionSegments,
        render_script: renderScript,
        creatomate_render_id: creatomateRenderId,
      },
    });
  }

  if (job.status === "rendering_final") {
    const renderId = output.creatomate_render_id;

    if (!renderId) {
      return updateJob(job.id, {
        status: "failed",
        current_step: "Failed",
        error_message: "Missing Creatomate render ID",
      });
    }

    const render = await getCreatomateRenderStatus(renderId);
    const renderStatus = String(render?.status || "").toLowerCase();

    if (renderStatus === "failed") {
      return updateJob(job.id, {
        status: "failed",
        current_step: "Failed",
        error_message: render?.error || "Creatomate render failed",
      });
    }

    if (renderStatus === "succeeded" || renderStatus === "completed") {
      return updateJob(job.id, {
        status: "completed",
        progress: 100,
        current_step: "Completed",
        output: {
          ...output,
          final_video_url: render?.url || render?.download_url || "",
          video_url: render?.url || render?.download_url || "",
          thumbnail_url: render?.snapshot_url || render?.thumbnail_url || "",
          creatomate_render: render,
        },
      });
    }

    return job;
  }

  return job;
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    if (req.method !== "GET") {
      return send(res, 405, { error: "Method not allowed" });
    }

    const jobId = String(req.query?.jobId || "").trim();

    if (!jobId) {
      return send(res, 400, { ok: false, error: "Missing jobId" });
    }

    let job = await getJobById(jobId);

    if (!job) {
      return send(res, 404, { ok: false, error: "Job not found" });
    }

    if (!["completed", "failed"].includes(job.status)) {
      job = await advanceJob(job);
    }

    return send(res, 200, {
      ok: true,
      job,
    });
  } catch (error) {
    console.error("[api/skeleton/job-status] error", error);

    return send(res, 500, {
      ok: false,
      error: error.message || "Failed to fetch job status",
    });
  }
};
