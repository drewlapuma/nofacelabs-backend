// api/_lib/submagic.js (CommonJS)
async function submagicCreateProject({ apiKey, videoUrl, title, language = "en", templateName, webhookUrl }) {
  const r = await fetch("https://api.submagic.co/v1/projects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      title,
      language,
      videoUrl,
      templateName,
      webhookUrl, // optional but recommended
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_CREATE_FAILED (${r.status})`);
  return j; // should contain id/status/etc
}

async function submagicGetProject({ apiKey, projectId }) {
  const r = await fetch(`https://api.submagic.co/v1/projects/${encodeURIComponent(projectId)}`, {
    headers: { "x-api-key": apiKey },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_GET_FAILED (${r.status})`);
  return j;
}

module.exports = { submagicCreateProject, submagicGetProject };
