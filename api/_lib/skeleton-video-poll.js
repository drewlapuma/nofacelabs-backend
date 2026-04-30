const { createClient } = require("@supabase/supabase-js");

const DEFAULT_BUCKET = process.env.SKELETON_ASSETS_BUCKET || "skeleton-assets";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase env vars for video clip upload");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function safeSegment(value, fallback = "unknown") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadVideoBuffer({ buffer, memberId, jobId, sceneIndex, contentType = "video/mp4" }) {
  const supabase = getSupabase();

  const safeMember = safeSegment(memberId, "anonymous");
  const safeJob = safeSegment(jobId, "job");
  const safeScene = safeSegment(sceneIndex, "scene");

  const path = `scene-clips/${safeMember}/${safeJob}/scene-${safeScene}-${Date.now()}.mp4`;

  const { error } = await supabase.storage
    .from(DEFAULT_BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || "Failed to upload scene clip");
  }

  const { data } = supabase.storage.from(DEFAULT_BUCKET).getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error("Could not create public scene clip URL");
  }

  return {
    url: data.publicUrl,
    path,
  };
}

async function downloadToBuffer(url, headers = {}) {
  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`Failed to download video clip: HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: res.headers.get("content-type") || "video/mp4",
  };
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase();
}

function isDoneStatus(status) {
  const s = normalizeStatus(status);
  return ["succeeded", "completed", "complete", "done", "ready"].includes(s);
}

function isFailedStatus(status) {
  const s = normalizeStatus(status);
  return ["failed", "error", "cancelled", "canceled"].includes(s);
}

function pickUrl(obj) {
  if (!obj || typeof obj !== "object") return "";

  return (
    obj.url ||
    obj.video_url ||
    obj.videoUrl ||
    obj.download_url ||
    obj.downloadUrl ||
    obj.output_url ||
    obj.outputUrl ||
    obj.result?.url ||
    obj.result?.video_url ||
    obj.result?.videoUrl ||
    obj.result?.download_url ||
    obj.result?.downloadUrl ||
    obj.output?.url ||
    obj.output?.video_url ||
    obj.output?.download_url ||
    obj.response?.generatedVideos?.[0]?.video?.uri ||
    obj.response?.generatedVideos?.[0]?.video?.url ||
    obj.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
    obj.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.url ||
    ""
  );
}

async function pollOpenAISoraScene({ scene, memberId, jobId }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const videoId = scene.providerJobId;
  if (!videoId) throw new Error("Missing OpenAI video id");

  const metaRes = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(videoId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  const meta = await metaRes.json().catch(() => ({}));

  if (!metaRes.ok) {
    throw new Error(
      meta?.error?.message ||
      meta?.message ||
      `OpenAI video status failed: HTTP ${metaRes.status}`
    );
  }

  const status = normalizeStatus(meta.status);

  if (isFailedStatus(status)) {
    throw new Error(meta?.error?.message || "OpenAI video generation failed");
  }

  if (!isDoneStatus(status)) {
    return {
      done: false,
      scene: {
        ...scene,
        videoStatus: meta.status || scene.videoStatus || "processing",
        providerRawStatus: meta,
      },
    };
  }

  const contentRes = await fetch(`https://api.openai.com/v1/videos/${encodeURIComponent(videoId)}/content`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
  });

  if (!contentRes.ok) {
    const text = await contentRes.text().catch(() => "");
    throw new Error(text || `OpenAI video content download failed: HTTP ${contentRes.status}`);
  }

  const buffer = Buffer.from(await contentRes.arrayBuffer());

  const uploaded = await uploadVideoBuffer({
    buffer,
    memberId,
    jobId,
    sceneIndex: scene.index,
    contentType: contentRes.headers.get("content-type") || "video/mp4",
  });

  return {
    done: true,
    scene: {
      ...scene,
      videoStatus: "completed",
      videoUrl: uploaded.url,
      videoPath: uploaded.path,
      providerRawStatus: meta,
    },
  };
}

async function pollGoogleVeoScene({ scene, memberId, jobId }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const operationName = scene.providerJobId;
  if (!operationName) throw new Error("Missing Google Veo operation name");

  const apiVersion = process.env.GOOGLE_GENAI_API_VERSION || "v1beta";
  const cleanName = String(operationName).replace(/^\/+/, "");

  const statusUrl =
    `https://generativelanguage.googleapis.com/${apiVersion}/${cleanName}` +
    `?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

  const res = await fetch(statusUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data?.error?.message ||
      data?.message ||
      JSON.stringify(data) ||
      `Google Veo status failed: HTTP ${res.status}`
    );
  }

  if (data?.error) {
    throw new Error(data.error.message || "Google Veo generation failed");
  }

  if (!data.done) {
    return {
      done: false,
      scene: {
        ...scene,
        videoStatus: "processing",
        providerRawStatus: data,
      },
    };
  }

  const videoUrl = pickUrl(data);

  if (!videoUrl) {
    throw new Error("Google Veo completed but no video URL was found in response");
  }

  const downloaded = await downloadToBuffer(videoUrl, {
    "x-goog-api-key": process.env.GEMINI_API_KEY,
  });

  const uploaded = await uploadVideoBuffer({
    buffer: downloaded.buffer,
    memberId,
    jobId,
    sceneIndex: scene.index,
    contentType: downloaded.contentType,
  });

  return {
    done: true,
    scene: {
      ...scene,
      videoStatus: "completed",
      videoUrl: uploaded.url,
      videoPath: uploaded.path,
      providerRawStatus: data,
    },
  };
}

async function pollXaiScene({ scene, memberId, jobId }) {
  if (!process.env.XAI_API_KEY) {
    throw new Error("Missing XAI_API_KEY");
  }

  const requestId = scene.providerJobId;
  if (!requestId) throw new Error("Missing xAI request id");

  const candidates = [
    `https://api.x.ai/v1/videos/generations/${encodeURIComponent(requestId)}`,
    `https://api.x.ai/v1/videos/generations/${encodeURIComponent(requestId)}/result`,
  ];

  let lastError = "";

  for (const url of candidates) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        Accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      lastError =
        data?.error?.message ||
        data?.message ||
        `xAI status failed: HTTP ${res.status}`;
      continue;
    }

    const status = normalizeStatus(data.status || data.state);

    if (isFailedStatus(status)) {
      throw new Error(data?.error?.message || data?.message || "xAI video generation failed");
    }

    const videoUrl = pickUrl(data);

    if (!isDoneStatus(status) && !videoUrl) {
      return {
        done: false,
        scene: {
          ...scene,
          videoStatus: data.status || data.state || "processing",
          providerRawStatus: data,
        },
      };
    }

    if (!videoUrl) {
      return {
        done: false,
        scene: {
          ...scene,
          videoStatus: data.status || data.state || "processing",
          providerRawStatus: data,
        },
      };
    }

    const downloaded = await downloadToBuffer(videoUrl);

    const uploaded = await uploadVideoBuffer({
      buffer: downloaded.buffer,
      memberId,
      jobId,
      sceneIndex: scene.index,
      contentType: downloaded.contentType,
    });

    return {
      done: true,
      scene: {
        ...scene,
        videoStatus: "completed",
        videoUrl: uploaded.url,
        videoPath: uploaded.path,
        providerRawStatus: data,
      },
    };
  }

  throw new Error(lastError || "xAI video status failed");
}

async function pollOneSceneVideo({ scene, memberId, jobId }) {
  if (scene.videoUrl) {
    return { done: true, scene };
  }

  const provider = String(scene.provider || "").toLowerCase();

  if (provider === "openai-sora") {
    return pollOpenAISoraScene({ scene, memberId, jobId });
  }

  if (provider === "google-veo") {
    return pollGoogleVeoScene({ scene, memberId, jobId });
  }

  if (provider === "xai-video") {
    return pollXaiScene({ scene, memberId, jobId });
  }

  throw new Error(`Unsupported scene video provider: ${provider || "unknown"}`);
}

async function pollSceneVideosOnce({ scenes, memberId, jobId }) {
  const nextScenes = [];
  let completed = 0;

  for (const scene of scenes) {
    if (scene.videoUrl) {
      nextScenes.push(scene);
      completed += 1;
      continue;
    }

    try {
      const result = await pollOneSceneVideo({ scene, memberId, jobId });
      nextScenes.push(result.scene);
      if (result.done) completed += 1;
    } catch (err) {
      nextScenes.push({
        ...scene,
        videoStatus: "failed",
        videoError: err.message || "Scene video polling failed",
      });

      throw err;
    }

    await sleep(250);
  }

  return {
    scenes: nextScenes,
    completed,
    total: nextScenes.length,
    allDone: nextScenes.length > 0 && completed === nextScenes.length,
  };
}

module.exports = {
  pollSceneVideosOnce,
};
