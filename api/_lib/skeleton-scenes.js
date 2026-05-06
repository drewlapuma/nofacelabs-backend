function getWordCount(text) {
  const t = String(text || "").trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
}

function estimateDurationSec(script, voiceSpeed = 1) {
  const text = String(script || "").trim();
  if (!text) return 0;

  const chars = text.replace(/\s/g, "").length;
  const words = getWordCount(text);
  const speed = Number(voiceSpeed) || 1;

  const wordBasedSec = words > 0
    ? Math.round((words / (150 * speed)) * 60)
    : 0;

  const charBasedSec = Math.round(chars / (12 * speed));
  const useCharBased = words <= 2 || chars / Math.max(words, 1) > 12;

  return Math.max(3, useCharBased ? charBasedSec : wordBasedSec);
}

function estimateScenes(script, options = {}) {
  const durationSec = Number(options.durationSec || estimateDurationSec(script, options.voiceSpeed || 1));
  const animationDuration = Number(options.animationDuration || 4);

  return Math.max(1, Math.ceil(durationSec / animationDuration));
}

function splitIntoScenes(script, sceneCount) {
  const sentences = String(script || "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!sentences.length) return [];

  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    text: "",
    index: i,
  }));

  sentences.forEach((sentence, i) => {
    const sceneIndex = Math.min(sceneCount - 1, Math.floor((i / sentences.length) * sceneCount));
    scenes[sceneIndex].text = `${scenes[sceneIndex].text} ${sentence}`.trim();
  });

  // Fill empty scenes by reusing nearby story context so every clip has a prompt.
  for (let i = 0; i < scenes.length; i++) {
    if (!scenes[i].text) {
      const previous = scenes[i - 1]?.text;
      const next = scenes[i + 1]?.text;
      scenes[i].text = previous || next || String(script || "").trim();
    }
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

  return scenes.map((scene, i) => ({
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
  }));
}

function planScenes(script, options = {}) {
  const sceneCount = estimateScenes(script, options);
  const split = splitIntoScenes(script, sceneCount);
  return buildScenePrompts(split);
}

module.exports = {
  planScenes,
  estimateDurationSec,
  estimateScenes,
};
