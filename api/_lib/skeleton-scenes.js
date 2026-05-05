function estimateScenes(script) {
  const words = String(script || "").trim().split(/\s+/).filter(Boolean).length;
  const scenes = Math.max(2, Math.ceil(words / 40)); // ~40 words per scene
  return scenes;
}

function splitIntoScenes(script, sceneCount) {
  const sentences = String(script || "")
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!sentences.length) return [];

  const perScene = Math.ceil(sentences.length / sceneCount);
  const scenes = [];

  for (let i = 0; i < sceneCount; i++) {
    const chunk = sentences
      .slice(i * perScene, (i + 1) * perScene)
      .join(". ")
      .trim();

    if (!chunk) continue;

    scenes.push({
      text: chunk,
      index: i,
    });
  }

  return scenes;
}

function buildStoryAnchor(scenes) {
  const firstSceneText = scenes?.[0]?.text || "";

  return `
Use one consistent realistic skeleton character throughout the story.
Keep the same general look, same overall outfit/accessories when relevant, and mostly the same setting/background style across scenes.
Things can change a little when the story calls for it, but keep the world feeling like the same story.
Realistic cinematic style, vertical 9:16, detailed, natural lighting, believable textures.
Base the setting direction loosely on this opening moment: ${firstSceneText}
  `.trim();
}

function buildScenePrompts(scenes) {
  const storyAnchor = buildStoryAnchor(scenes);

  return scenes.map((scene, i) => {
    return {
      index: i,
      text: scene.text,

      imagePrompt: `
${storyAnchor}

Scene ${i + 1}:
${scene.text}

Create a realistic cinematic image of this moment.
Keep the same main skeleton character and mostly the same setting/style as the other scenes.
Allow small natural variation in composition and camera angle, but keep the story world visually consistent.
Ultra realistic, high detail, film still quality, 9:16.
      `.trim(),

      videoPrompt: `
${storyAnchor}

Scene ${i + 1}:
${scene.text}

Create a realistic cinematic animation of this exact scene.
Keep the same main skeleton character, outfit/accessories, and mostly the same setting/style as the other scenes.
No dialogue, no narration, no singing, no music.
Only subtle natural sound effects if audio is generated.
      `.trim(),
    };
  });
}

function planScenes(script) {
  const sceneCount = estimateScenes(script);
  const split = splitIntoScenes(script, sceneCount);
  return buildScenePrompts(split);
}

module.exports = { planScenes };
