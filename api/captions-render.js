// api/captions-render.js
// POST /api/captions-render
// { videoUrl, audioUrl, mode: "sentence"|"word", preset: "minimal"|"bold_pop"|"karaoke" }
// -> { ok, renderId, status, url? }

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",").map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function presetStyle(preset) {
  // You can tweak these anytime to create “more templates”
  if (preset === "bold_pop") {
    return {
      font_family: "Montserrat",
      font_weight: 900,
      font_size: 84,
      fill_color: "#FFFFFF",
      stroke_color: "#000000",
      stroke_width: 10,
      shadow_color: "#000000",
      shadow_blur: 12,
      shadow_opacity: 0.7,
      y: "82%",
    };
  }

  if (preset === "karaoke") {
    // sentence line + highlighted word line
    return {
      font_family: "Montserrat",
      font_weight: 800,
      font_size: 72,
      fill_color: "#FFFFFF",
      stroke_color: "#000000",
      stroke_width: 8,
      shadow_color: "#000000",
      shadow_blur: 10,
      shadow_opacity: 0.6,
      y_sentence: "78%",
      y_word: "88%",
      highlight_fill: "#5AC1FF", // your brand
    };
  }

  // minimal
  return {
    font_family: "Inter",
    font_weight: 800,
    font_size: 64,
    fill_color: "#FFFFFF",
    stroke_color: "#000000",
    stroke_width: 0,
    shadow_color: "#000000",
    shadow_blur: 10,
    shadow_opacity: 0.45,
    y: "84%",
  };
}

function makeTextElement({ id, text, start, duration, style }) {
  return {
    id,
    type: "text",
    text,
    time: start,
    duration,
    x: "50%",
    y: style.y,
    width: "92%",
    height: "30%",
    font_family: style.font_family,
    font_weight: style.font_weight,
    font_size: style.font_size,
    fill_color: style.fill_color,
    stroke_color: style.stroke_color,
    stroke_width: style.stroke_width,
    shadow_color: style.shadow_color,
    shadow_blur: style.shadow_blur,
    shadow_opacity: style.shadow_opacity,
    text_align: "center",
    vertical_align: "middle",
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const videoUrl = String(body.videoUrl || "").trim();
    const audioUrl = String(body.audioUrl || "").trim();
    const mode = String(body.mode || "sentence").trim();     // "sentence" | "word"
    const preset = String(body.preset || "minimal").trim();  // "minimal"|"bold_pop"|"karaoke"

    if (!videoUrl) return res.status(400).json({ ok: false, error: "MISSING_VIDEO_URL" });
    if (!audioUrl) return res.status(400).json({ ok: false, error: "MISSING_AUDIO_URL" });

    // 1) Build captions from your own endpoint
    const buildUrl = `https://${req.headers.host}/api/captions-build`;
    const rb = await fetch(buildUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioUrl, mode: preset === "karaoke" ? "word" : mode }),
    });
    const bj = await rb.json().catch(() => ({}));
    if (!rb.ok || !bj.ok) return res.status(500).json({ ok: false, error: "CAPTIONS_BUILD_FAILED", detail: bj });

    const items = bj.items || [];
    const style = presetStyle(preset);

    // 2) Build Creatomate source JSON (post-process overlay)
    const elements = [];

    // background video
    elements.push({
      id: "bg",
      type: "video",
      source: videoUrl,
      x: "50%",
      y: "50%",
      width: "100%",
      height: "100%",
    });

    if (preset === "karaoke") {
      // Karaoke = sentence (segment) + word highlight line under it
      // We'll create:
      // - A sentence element using segments (we can approximate by grouping words into a window)
      // - A current-word element per word

      // Simple approach:
      // Sentence line = entire transcript chunks by segment size (fallback: just show full text is too much).
      // If your transcribe endpoint returns segments too, you can pass mode="sentence" and also fetch words.
      // For now: build sentence from "sentence mode" call:
      const rb2 = await fetch(buildUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioUrl, mode: "sentence" }),
      });
      const bj2 = await rb2.json().catch(() => ({}));
      const segs = (bj2.ok ? bj2.items : []) || [];

      // Sentence elements (segments)
      for (const seg of segs) {
        elements.push({
          ...makeTextElement({
            id: `s_${seg.id}`,
            text: seg.text,
            start: seg.start,
            duration: seg.duration,
            style: { ...style, y: style.y_sentence },
          }),
        });
      }

      // Current-word elements (words)
      for (const w of items) {
        elements.push({
          ...makeTextElement({
            id: `k_${w.id}`,
            text: w.text,
            start: w.start,
            duration: w.duration,
            style: {
              ...style,
              y: style.y_word,
              font_size: Math.max(70, style.font_size + 8),
              fill_color: style.highlight_fill,
            },
          }),
        });
      }
    } else {
      // Normal = just render items
      for (const it of items) {
        elements.push(makeTextElement({
          id: it.id,
          text: it.text,
          start: it.start,
          duration: it.duration,
          style,
        }));
      }
    }

    const source = {
      output_format: "mp4",
      width: 1080,
      height: 1920,
      elements,
    };

    // 3) Create render
    const cr = await fetch("https://api.creatomate.com/v1/renders", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CREATOMATE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source }),
    });

    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok) return res.status(500).json({ ok: false, error: "CREATOMATE_RENDER_CREATE_FAILED", detail: cj });

    // Creatomate typically returns an array or object depending on endpoint response
    const first = Array.isArray(cj) ? cj[0] : cj;
    return res.status(200).json({
      ok: true,
      renderId: first?.id || null,
      status: first?.status || "processing",
      url: first?.url || first?.result_url || null,
      detail: first,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
