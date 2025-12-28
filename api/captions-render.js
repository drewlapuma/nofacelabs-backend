// api/captions-render.js
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",").map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function presetStyle(preset) {
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
      highlight_fill: "#5AC1FF",
    };
  }
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

function makeTextElement({ id, text, start, duration, style, yOverride }) {
  return {
    id,
    type: "text",
    text,
    time: start,
    duration: Math.max(0.01, duration),
    x: "50%",
    y: yOverride || style.y,
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

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { r, j };
}

async function creatomateCreateRender(source) {
  const r = await fetch("https://api.creatomate.com/v1/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || "CREATOMATE_CREATE_FAILED");
  const first = Array.isArray(j) ? j[0] : j;
  return first;
}

async function creatomateGetRender(id) {
  const r = await fetch(`https://api.creatomate.com/v1/renders/${id}`, {
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || "CREATOMATE_GET_FAILED");
  return j;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });

    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const dbId = String(body.dbId || body.id || "").trim();
    const videoUrl = String(body.videoUrl || "").trim();
    const audioUrl = String(body.audioUrl || "").trim();
    const preset = String(body.preset || "minimal").trim();
    const mode = String(body.mode || "sentence").trim();

    if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_DB_ID" });
    if (!videoUrl) return res.status(400).json({ ok: false, error: "MISSING_VIDEO_URL" });
    if (!audioUrl) return res.status(400).json({ ok: false, error: "MISSING_AUDIO_URL" });

    // verify the row belongs to the member
    const { data: row } = await sb.from("renders").select("*").eq("id", dbId).eq("member_id", member_id).single();
    if (!row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

    // mark captioning
    await sb.from("renders").update({
      caption_status: "captioning",
      caption_error: null,
      caption_template_id: preset,
    }).eq("id", dbId);

    // build captions
    const buildUrl = `https://${req.headers.host}/api/captions-build`;

    // karaoke needs words + segments
    const wantWords = preset === "karaoke" || mode === "word";
    const wantSegs = preset === "karaoke" || mode === "sentence";

    const wordsRes = wantWords ? await postJSON(buildUrl, { audioUrl, mode: "word" }) : null;
    const segsRes  = wantSegs  ? await postJSON(buildUrl, { audioUrl, mode: "sentence" }) : null;

    if (wordsRes && (!wordsRes.r.ok || !wordsRes.j.ok)) throw new Error("CAPTIONS_BUILD_WORD_FAILED");
    if (segsRes  && (!segsRes.r.ok  || !segsRes.j.ok))  throw new Error("CAPTIONS_BUILD_SENTENCE_FAILED");

    const words = (wordsRes?.j?.items || []);
    const segs  = (segsRes?.j?.items || []);

    const style = presetStyle(preset);
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
      for (const s of segs) {
        elements.push(makeTextElement({
          id: `s_${s.id}`,
          text: s.text,
          start: s.start,
          duration: s.duration,
          style: { ...style, y: style.y_sentence },
          yOverride: style.y_sentence,
        }));
      }
      for (const w of words) {
        elements.push(makeTextElement({
          id: `w_${w.id}`,
          text: w.text,
          start: w.start,
          duration: w.duration,
          style: {
            ...style,
            fill_color: style.highlight_fill,
            font_size: Math.max(70, style.font_size + 8),
          },
          yOverride: style.y_word,
        }));
      }
    } else if (mode === "word") {
      for (const w of words) {
        elements.push(makeTextElement({
          id: w.id,
          text: w.text,
          start: w.start,
          duration: w.duration,
          style,
        }));
      }
    } else {
      for (const s of segs) {
        elements.push(makeTextElement({
          id: s.id,
          text: s.text,
          start: s.start,
          duration: s.duration,
          style,
        }));
      }
    }

    const source = { output_format: "mp4", width: 1080, height: 1920, elements };

    // create render
    const created = await creatomateCreateRender(source);
    const renderId = created?.id;

    // poll until done (up to ~70s)
    let finalUrl = created?.url || created?.result_url || null;
    let status = created?.status || "processing";

    for (let i = 0; i < 14; i++) {
      if (status === "succeeded" && finalUrl) break;
      if (status === "failed") break;
      await sleep(5000);
      const latest = await creatomateGetRender(renderId);
      status = latest?.status || status;
      finalUrl = latest?.url || latest?.result_url || finalUrl;
    }

    if (status !== "succeeded" || !finalUrl) {
      await sb.from("renders").update({
        caption_status: "failed",
        caption_error: `CREATOMATE_${status || "UNKNOWN"}`,
      }).eq("id", dbId);

      return res.status(200).json({ ok: false, error: "CAPTION_RENDER_NOT_READY", status, renderId });
    }

    await sb.from("renders").update({
      caption_status: "completed",
      caption_error: null,
      captioned_video_url: finalUrl,
    }).eq("id", dbId);

    return res.status(200).json({ ok: true, status: "completed", renderId, url: finalUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
