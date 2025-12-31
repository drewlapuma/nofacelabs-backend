// api/auto-captions.js
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();
const API_BASE = (process.env.API_BASE || "").trim();

const INTERNAL_WEBHOOK_SECRET = (process.env.INTERNAL_WEBHOOK_SECRET || "").trim();
const DEFAULT_CAPTION_STYLE = (process.env.DEFAULT_CAPTION_STYLE || "sentence").trim().toLowerCase();

// ✅ FROM YOUR TEMPLATE SCREENSHOT:
const CREATO_VIDEO_ELEMENT_ID = "Video-DHM";

function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "9:16").trim();
  const map = {
    "9:16": (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim(),
    "1:1": (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim(),
    "16:9": (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim(),
  };
  return map[ar] || map["9:16"];
}

const sb =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(bodyObj);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          Authorization: headers.Authorization,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(buf || "{}") });
          } catch {
            resolve({ status: res.statusCode, json: { raw: buf } });
          }
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    if (!sb) return res.status(500).json({ ok: false, error: "MISSING_SUPABASE_ENV_VARS" });
    if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });

    // 🔒 secret protection
    const secret = String(req.headers["x-internal-admin"] || "").trim();
    if (!INTERNAL_WEBHOOK_SECRET || secret !== INTERNAL_WEBHOOK_SECRET) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const id = String(body?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

    const style = String(body?.style || DEFAULT_CAPTION_STYLE || "sentence").trim().toLowerCase();
    const styleSafe = ["sentence", "karaoke", "word"].includes(style) ? style : "sentence";

    const { data: row, error } = await sb.from("renders").select("*").eq("id", id).single();
    if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
    if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

    // avoid duplicate caption jobs
    if (row.captioned_video_url) return res.status(200).json({ ok: true, already: true });
    if (String(row.caption_status || "").toLowerCase() === "captioning" && row.caption_render_id) {
      return res.status(200).json({ ok: true, already: true, caption_render_id: row.caption_render_id });
    }

    const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
    const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);
    if (!template_id) return res.status(500).json({ ok: false, error: "MISSING_CAPTIONS_TEMPLATE" });

    await sb.from("renders").update({
      caption_status: "captioning",
      caption_error: null,
      captioned_video_url: null,
      caption_template_id: `creatomate:${template_id}`,
      caption_style: styleSafe,
    }).eq("id", row.id);

    const mods = {
      // ✅ correct element id:
      [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),

      // ✅ layer toggles (match your template)
      "Subtitles_Sentence.visible": styleSafe === "sentence",
      "Subtitles_Karaoke.visible": styleSafe === "karaoke",
      "Subtitles_Word.visible": styleSafe === "word",
    };

    const publicBaseUrl = API_BASE || `https://${req.headers.host}`;
    const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(row.id)}&kind=caption`;

    const resp = await postJSON(
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
      { template_id, modifications: mods, output_format: "mp4", webhook_url }
    );

    if (resp.status !== 202 && resp.status !== 200) {
      await sb.from("renders").update({ caption_status: "failed", caption_error: JSON.stringify(resp.json) }).eq("id", row.id);
      return res.status(resp.status).json({ ok: false, error: "CREATOMATE_ERROR", details: resp.json });
    }

    const caption_render_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
    if (!caption_render_id) {
      await sb.from("renders").update({ caption_status: "failed", caption_error: "NO_CAPTION_JOB_ID" }).eq("id", row.id);
      return res.status(502).json({ ok: false, error: "NO_CAPTION_JOB_ID", details: resp.json });
    }

    await sb.from("renders").update({ caption_render_id: String(caption_render_id), caption_status: "captioning" }).eq("id", row.id);

    return res.status(200).json({ ok: true, caption_render_id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
