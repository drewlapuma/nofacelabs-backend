const { getBuiltInSkeletonReferenceImages } = require("./skeleton-reference-images");

function getBackendBase() {
  const base =
    process.env.BACKEND_BASE ||
    process.env.NEXT_PUBLIC_BACKEND_BASE ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (!base) {
    throw new Error("Missing BACKEND_BASE env var");
  }

  return base.replace(/\/$/, "");
}

async function generateSceneImages({ scenes, model, memberId }) {
  const results = [];
  const referenceImages = getBuiltInSkeletonReferenceImages();
  const backendBase = getBackendBase();

  for (const scene of scenes) {
    const res = await fetch(`${backendBase}/api/tools-generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nf-member-id": memberId,
      },
      body: JSON.stringify({
        prompt: scene.imagePrompt,
        model,
        aspectRatio: "9:16",

        // Only the skeleton flow sends these.
        // Your regular image generator will not use skeleton refs.
        referenceImages,
        forceSkeletonReferences: true,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Image generation failed for scene ${scene.index}`);
    }

    results.push({
      ...scene,
      imageUrl: data.downloadUrl,
      imagePath: data.outputPath || "",
    });
  }

  return results;
}

module.exports = { generateSceneImages };
