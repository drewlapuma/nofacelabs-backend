const { getBuiltInSkeletonReferenceImages } = require("./skeleton-reference-images");

async function generateSceneImages({ scenes, model, memberId }) {
  const results = [];
  const referenceImages = getBuiltInSkeletonReferenceImages();

  for (const scene of scenes) {
    const res = await fetch(`${process.env.BACKEND_BASE}/api/tools-generate-image`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nf-member-id": memberId,
      },
      body: JSON.stringify({
        prompt: scene.imagePrompt,
        model,
        aspectRatio: "9:16",

        // Only skeleton flow sends this.
        // Other image generators on your site will not use these refs.
        referenceImages,
        forceSkeletonReferences: true,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || "Image generation failed");
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
