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

async function generateSceneVideos({
  scenes,
  model,
  duration,
  resolution,
  memberId,
}) {
  const results = [];
  const backendBase = getBackendBase();

  for (const scene of scenes) {
    if (!scene.imageUrl) {
      throw new Error(`Missing imageUrl for scene ${scene.index}`);
    }

    const res = await fetch(`${backendBase}/api/tools-generate-video`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-nf-member-id": memberId,
      },
      body: JSON.stringify({
        prompt: scene.videoPrompt,
        model,
        durationSeconds: String(duration),
        aspectRatio: "9:16",
        resolution,
        imageUrl: scene.imageUrl,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Video generation failed for scene ${scene.index}`);
    }

    results.push({
      ...scene,
      imageUrl: scene.imageUrl,
      provider: data.provider || "",
      providerJobId: data.providerJobId || "",
      videoStatus: data.status || "queued",
      pollAfterMs: Number(data.pollAfterMs || 4000),
      normalizedConfig: data.normalizedConfig || {},
      providerRaw: data.providerRaw || {},
    });
  }

  return results;
}

module.exports = { generateSceneVideos };
