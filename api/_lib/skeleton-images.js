async function generateSceneImages({ scenes, model, memberId }) {
  const results = [];

  for (const scene of scenes) {
    const res = await fetch(
      `${process.env.BACKEND_BASE}/api/tools-generate-image`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nf-member-id": memberId,
        },
        body: JSON.stringify({
          prompt: scene.imagePrompt,
          model,
          aspectRatio: "9:16",
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error("Image generation failed");
    }

    results.push({
      ...scene,
      imageUrl: data.downloadUrl,
    });
  }

  return results;
}

module.exports = { generateSceneImages };
