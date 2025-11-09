// api/generate-script.js  (CommonJS)

module.exports = async (req, res) => {
  // CORS (same style as your other handlers)
  const allowOrigin = process.env.ALLOW_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const storyType  = body.storyType  || 'Motivational';
    const artStyle   = body.artStyle   || 'Scary toon';
    const language   = body.language   || 'English';
    const targetBeats =
      Math.min(Math.max(parseInt(body.targetBeats || '6', 10), 3), 10);

    // Super-simple, deterministic script generator so your pipeline works
    const title = `${storyType} Story`;
    const intro =
      language === 'English'
        ? `Here is a short ${storyType.toLowerCase()} story, told in a ${artStyle.toLowerCase()} style.`
        : `Here is a short story in ${language}.`;

    const beats = [];
    for (let i = 1; i <= targetBeats; i++) {
      beats.push({
        index: i,
        caption: `Part ${i} of the ${storyType.toLowerCase()} story. Describe a key moment or idea here.`,
        imagePrompt: `${artStyle} illustration of part ${i} of a ${storyType.toLowerCase()} story`,
      });
    }

    const narration =
      `${title}.\n\n` +
      `${intro}\n\n` +
      beats
        .map(
          (b) =>
            `Scene ${b.index}: ${b.caption} This should match the visuals generated from: "${b.imagePrompt}".`
        )
        .join('\n\n');

    // This is the shape /api/create-video expects:
    return res.status(200).json({
      narration,
      beats,
      meta: {
        storyType,
        artStyle,
        language,
        targetBeats,
      },
    });
  } catch (err) {
    console.error('[GENERATE_SCRIPT] error', err);
    return res
      .status(500)
      .json({ error: 'INTERNAL', message: String(err?.message || err) });
  }
};
