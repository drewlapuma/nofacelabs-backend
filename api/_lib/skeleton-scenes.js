function estimateScenes(script) {
  const words = script.split(/\s+/).length;
  const scenes = Math.max(2, Math.ceil(words / 40)); // ~40 words per scene
  return scenes;
}

function splitIntoScenes(script, sceneCount) {
  const sentences = script.split(/[.!?]+/).filter(Boolean);

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

function buildScenePrompts(scenes) {
  return scenes.map((scene, i) => {
    return {
      index: i,
      text: scene.text,

      imagePrompt: `
Realistic cinematic scene, skeleton character (consistent character across scenes),
${scene.text},
dramatic lighting, ultra realistic, 9:16, high detail, film still
      `.trim(),

      videoPrompt: `
Realistic cinematic animation of the same scene:
${scene.text},
natural motion, smooth camera movement, realistic lighting
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
