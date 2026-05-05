function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(script) {
  return cleanText(script)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function estimateScenes(script) {
  const words = cleanText(script).split(/\s+/).filter(Boolean).length;

  // Slightly tighter pacing than before, but still not too choppy
  // ~32 words per scene, minimum 2 scenes
  const scenes = Math.max(2, Math.ceil(words / 32));
  return scenes;
}

function splitIntoScenes(script, sceneCount) {
  const sentences = splitSentences(script);
  const perScene = Math.max(1, Math.ceil(sentences.length / sceneCount));
  const scenes = [];

  for (let i = 0; i < sceneCount; i++) {
    const chunk = sentences
      .slice(i * perScene, (i + 1) * perScene)
      .join(" ")
      .trim();

    if (!chunk) continue;

    scenes.push({
      text: chunk,
      index: i,
    });
  }

  return scenes;
}

function buildStoryBible(scenes) {
  const openingSceneText = scenes?.[0]?.text || "";

  return {
    character: `
MAIN CHARACTER:
A single realistic skeleton main character must remain consistent across the entire video.
Use the same skull shape, facial bone structure, body proportions, height impression, and overall identity in every scene.
This is one continuous character, not a different skeleton in each scene.
If other humans appear because the script calls for them, keep the skeleton as the core main character.
    `.trim(),

    wardrobe: `
WARDROBE / ACCESSORIES:
Keep the same outfit, clothes, and accessories across all scenes unless the script explicitly requires a change.
Do not randomly change clothing, props, or accessories.
If an accessory or outfit is introduced, keep it consistent throughout the story unless there is a clear narrative reason to change it.
    `.trim(),

    setting: `
SETTING / BACKGROUND:
Establish the main setting from the story and keep it visually consistent across scenes.
The opening scene should define the base environment and background style.
Do not randomly change the location, room, street, landscape, architecture, or environment unless the script clearly requires a cutaway or a location change.
If a cutaway is necessary, it should still feel visually connected to the same story world.
Opening scene context: ${openingSceneText}
    `.trim(),

    style: `
VISUAL STYLE:
Use realistic cinematic style only.
Vertical 9:16 composition.
High detail, realistic textures, believable anatomy, realistic lighting, and cinematic composition.
No cartoon look. No fantasy glow. No random stylization changes.
Use a grounded, cohesive visual tone across the whole video.
    `.trim(),

    continuity: `
CONTINUITY RULES:
Maintain character consistency, wardrobe consistency, and setting consistency across every scene.
Each scene should feel like part of one continuous story.
Do not redesign the character between scenes.
Do not randomly change background, weather, time of day, props, or clothing unless the narration clearly calls for it.
    `.trim(),
  };
}

function shouldAllowCutaway(sceneText) {
  const text = String(sceneText || "").toLowerCase();

  const cutawaySignals = [
    "flashback",
    "memory",
    "meanwhile",
    "at the same time",
    "cut to",
    "news report",
    "security camera",
    "close-up of",
    "inside the",
    "show the",
    "we see",
    "vision of",
    "dream",
    "imagines",
    "imagining",
    "picture this",
    "elsewhere",
    "in another place",
  ];

  return cutawaySignals.some((signal) => text.includes(signal));
}

function buildScenePrompts(scenes) {
  const storyBible = buildStoryBible(scenes);

  return scenes.map((scene, i) => {
    const prevScene = i > 0 ? scenes[i - 1].text : "";
    const nextScene = i < scenes.length - 1 ? scenes[i + 1].text : "";
    const allowCutaway = shouldAllowCutaway(scene.text);

    const continuityBlock = `
${storyBible.character}

${storyBible.wardrobe}

${storyBible.setting}

${storyBible.style}

${storyBible.continuity}
    `.trim();

    const imagePrompt = `
Create a realistic cinematic scene image for a vertical 9:16 AI video.

${continuityBlock}

SCENE ROLE:
This is scene ${i + 1} of ${scenes.length}.

CURRENT SCENE CONTENT:
${scene.text}

PREVIOUS SCENE CONTEXT:
${prevScene || "This is the opening scene."}

NEXT SCENE CONTEXT:
${nextScene || "This is the final scene."}

SCENE INSTRUCTIONS:
Show the main skeleton character in a way that directly matches the script.
Preserve the same main character identity, same outfit, same accessories, and same main environment as the rest of the story.
${
  allowCutaway
    ? "A cutaway is allowed only if it clearly helps illustrate this exact part of the narration, but it must still feel like the same story world."
    : "Do not use a cutaway. Keep the scene in the same main setting and story world."
}
Use realistic cinematic framing, realistic lighting, realistic textures, and high detail.
Make the image feel like a film still from one continuous story.
    `.trim();

    const videoPrompt = `
Animate this scene as a realistic cinematic vertical 9:16 video.

GLOBAL CONTINUITY:
Use the exact same main skeleton character, same outfit, same accessories, and same setting established by the reference scene image.
Do not redesign the character.
Do not change the wardrobe.
Do not randomly change the background or location.
Preserve the scene identity from the input image.

CURRENT SCENE CONTENT:
${scene.text}

ANIMATION DIRECTION:
Natural motion only.
Subtle realistic body movement, environmental motion, and cinematic camera movement.
Motion should match the script and remain grounded and believable.
Keep continuity with the previous and next scenes.

AUDIO RULES:
No dialogue.
No speech.
No AI voice.
No narration.
No singing.
No music.
Only subtle natural sound effects if audio is generated, such as footsteps, cloth movement, object handling, room tone, wind, impacts, or environmental ambience that matches the scene.

VISUAL RULES:
Realistic cinematic lighting.
Realistic textures.
Vertical 9:16.
Keep the same character, clothes, and setting unless the script clearly requires a change.
${
  allowCutaway
    ? "If this scene must be a cutaway, keep it tightly tied to the story and visually consistent with the rest of the video."
    : "Do not turn this into a random cutaway."
}
    `.trim();

    return {
      index: i,
      text: scene.text,
      allowCutaway,
      storyBible,
      imagePrompt,
      videoPrompt,
    };
  });
}

function planScenes(script) {
  const cleaned = cleanText(script);
  const sceneCount = estimateScenes(cleaned);
  const split = splitIntoScenes(cleaned, sceneCount);
  return buildScenePrompts(split);
}

module.exports = { planScenes };
