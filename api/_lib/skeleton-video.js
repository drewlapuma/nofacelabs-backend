async function generateSceneVideos({
  scenes,
  model,
  duration,
  resolution,
  memberId,
}) {
  const results = [];

  for (const scene of scenes) {
    const res = await fetch(
      `${process.env.BACKEND_BASE}/api/tools-generate-video`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-nf-member-id": memberId,
        },
        body: JSON.stringify({
          prompt: scene.videoPrompt,
          model,
          durationSeconds: duration,
          aspectRatio: "9:16",
          resolution,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      throw new Error("Video generation failed");
    }

    results.push({
      ...scene,
      videoJobId: data.providerJobId,
    });
  }

  return results;
}

module.exports = { generateSceneVideos };
