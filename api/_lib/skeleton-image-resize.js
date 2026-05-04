// api/_lib/skeleton-image-resize.js

const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");

const DEFAULT_BUCKET = process.env.SKELETON_ASSETS_BUCKET || "skeleton-assets";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase env vars for resized image upload");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getTargetSize(resolution) {
  if (resolution === "1080p") {
    return { width: 1080, height: 1920 };
  }

  return { width: 720, height: 1280 };
}

function safeSegment(value, fallback = "unknown") {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 100);
}

async function downloadImageBuffer(imageUrl) {
  const res = await fetch(imageUrl);

  if (!res.ok) {
    throw new Error(`Failed to download scene image for resizing: HTTP ${res.status}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function resizeSceneImageForVideo({
  imageUrl,
  resolution = "720p",
  memberId = "anonymous",
  jobId = "job",
  sceneIndex = "scene",
}) {
  if (!imageUrl) {
    throw new Error("Missing imageUrl for resize");
  }

  const { width, height } = getTargetSize(resolution);
  const inputBuffer = await downloadImageBuffer(imageUrl);

  const outputBuffer = await sharp(inputBuffer)
    .resize(width, height, {
      fit: "cover",
      position: "center",
    })
    .png()
    .toBuffer();

  const supabase = getSupabase();

  const safeMember = safeSegment(memberId, "anonymous");
  const safeJob = safeSegment(jobId, "job");
  const safeScene = safeSegment(sceneIndex, "scene");

  const path = `scene-images-resized/${safeMember}/${safeJob}/scene-${safeScene}-${width}x${height}-${Date.now()}.png`;

  const { error } = await supabase.storage
    .from(DEFAULT_BUCKET)
    .upload(path, outputBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (error) {
    throw new Error(error.message || "Failed to upload resized scene image");
  }

  const { data } = supabase.storage.from(DEFAULT_BUCKET).getPublicUrl(path);

  if (!data?.publicUrl) {
    throw new Error("Could not create public resized image URL");
  }

  return {
    url: data.publicUrl,
    path,
    width,
    height,
  };
}

module.exports = {
  resizeSceneImageForVideo,
};
