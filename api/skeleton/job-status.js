const { getJobById, updateJob } = require("../_lib/skeleton-jobs");
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

function getPlaceholderSceneClips({ estimatedSceneCount, animationDuration }) {
  const count = Math.max(1, Number(estimatedSceneCount) || 1);
  const dur = Math.max(0.1, Number(animationDuration) || 4);

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

  const chunks = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);

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

async function advanceJob(job) {
  const input = job.input || {};
  const output = job.output || {};

  if (job.status === "queued") {
    return updateJob(job.id, {
      status: "generating_voice",
      progress: 18,
      current_step: "Generating voice",
      output: {
        ...output,
        narration_audio_url: getPlaceholderNarrationAudioUrl(),
      },
    });
  }

  if (job.status === "generating_voice") {
    const sceneClips = getPlaceholderSceneClips({
      estimatedSceneCount: job.credits?.estimatedSceneCount,
      animationDuration: input.animationDuration,
    });

    return updateJob(job.id, {
      status: "planning_scenes",
      progress: 36,
      current_step: "Planning scenes",
      output: {
        ...output,
        scene_clips: sceneClips,
      },
    });
  }

  if (job.status === "planning_scenes") {
    return updateJob(job.id, {
      status: "animating_scenes",
      progress: 58,
      current_step: "Animating scenes",
    });
  }

  if (job.status === "animating_scenes") {
    const sceneClips = output.scene_clips || [];
    const totalDuration = sceneClips.reduce(
      (sum, clip) => sum + Number(clip.duration || 0),
      0
    );

    const captionSegments = input.captionsEnabled
      ? getPlaceholderCaptionSegments(totalDuration, input.script)
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
      progress: 82,
      current_step: "Waiting for Creatomate render",
      output: {
        ...output,
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
