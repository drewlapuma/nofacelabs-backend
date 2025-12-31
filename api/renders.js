// api/renders.js (CommonJS, Node 18 on Vercel)
// Handles:
//  - GET /api/renders            => list renders for member
//  - GET /api/renders?id=...     => single render for member
//  - POST /api/renders {action:"captions-apply", id, style}  => make captioned copy via captions template
//  - POST /api/renders {action:"captions-change", id, style} => RE-RENDER MAIN video with new caption style

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

// -------------------- CORS --------------------
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// -------------------- Memberstack auth --------------------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) throw new Error("MISSING_AUTH");
  if (!ms) throw new Error("MISSING_MEMBERSTACK_SECRET_KEY");

  const { id } = await ms.verifyToken({ token });
  if (!id) throw new Error("INVALID_MEMBER_TOKEN");
  return String(id);
}

// -------------------- Creatomate --------------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

// MAIN templates (same ones create-video.js uses)
const MAIN_TEMPLATE_916 = (process.env.CREATO_TEMPLATE_916 || "").trim();
const MAIN_TEMPLATE_11  = (process.env.CREATO_TEMPLATE_11 || "").trim();
const MAIN_TEMPLATE_169 = (process.env.CREATO_TEMPLATE_169 || "").trim();

// Captions templates (separate caption-copy templates)
const CAPTIONS_TEMPLATE_916 = (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim();
const CAPTIONS_TEMPLATE_11  = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

// Element IDs inside captions template
const CREATO_VIDEO_ELEMENT_ID = (process.env.CREATO_VIDEO_ELEMENT_ID || "Video-DHM").trim();
const CREATO_CAPTIONS_JSON_ELEMENT_ID = (process.env.CREATO_CAPTIONS_JSON_ELEMENT_ID || "Subtitles-1").trim();

// Must be public for Creatomate webhook URLs
const API_BASE = (process.env.API_BASE || "").trim();

function pickMainTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "9:16").trim();
  if (ar === "9:16") return MAIN_TEMPLATE_916;
  if (ar === "1:1") return MAIN_TEMPLATE_11;
  if (ar === "16:9") return MAIN_TEMPLATE_169;
  return MAIN_TEMPLATE_916 || MAIN_TEMPLATE_11 || MAIN_TEMPLATE_169 || "";
}

function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "9:16").trim();
  if (ar === "9:16") return CAPTIONS_TEMPLATE_916;
  if (ar === "1:1") return CAPTIONS_TEMPLATE_11;
  if (ar === "16:9") return CAPTIONS_TEMPLATE_169;
  return CAPTIONS_TEMPLATE_916 || CAPTIONS_TEMPLATE_11 || CAPTIONS_TEMPLATE_169 || "";
}

// HTTPS JSON helper (Creatomate)
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
          let json = {};
          try {
            json = JSON.parse(buf || "{}");
          } catch {
            json = { raw: buf };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// IMPORTANT: exactly one captions layer visible (prevents double captions)
function subtitleVisibilityMods(captionStyle) {
  const style = String(captionStyle || "sentence").toLowerCase();

  const mods = {
    "Subtitles_Sentence.visible": false,
    "Subtitles_Karaoke.visible": false,
    "Subtitles_Word.visible": false,
    "Subtitles-1.visible": false,
  };

  if (style === "karaoke") mods["Subtitles_Karaoke.visible"] = true;
  else if (style === "word") mods["Subtitles_Word.visible"] = true;
  else mods["Subtitles_Sentence.visible"] = true;

  return mods;
}

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    // ---------------- GET ----------------
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();

      if (id) {
        const { data: item, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !item) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        return res.status(200).json({ ok: true, item });
      }

      const { data: items, error } = await sb
        .from("renders")
        .select("*")
        .eq("member_id", member_id)
        .order("created_at", { ascending: false })
        .limit(60);

      if (error) return res.status(500).json({ ok: false, error: "DB_READ_FAILED", details: error });
      return res.status(200).json({ ok: true, items: items || [] });
    }

    // ---------------- POST ----------------
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const action = String(body?.action || "").trim();

      // ==========================================================
      // captions-change  ✅ RE-RENDER MAIN video with new caption style
      // ==========================================================
      if (action === "captions-change") {
        const id = String(body?.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

        const style = String(body?.style || "sentence").trim().toLowerCase();
        const styleSafe = ["sentence", "karaoke", "word"].includes(style) ? style : "sentence";

        if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });

        const { data: row, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

        const choices = row.choices || {};
        const aspectRatio = choices.aspectRatio || choices.aspect_ratio || "9:16";
        const template_id = pickMainTemplateIdByAspect(aspectRatio);
        if (!template_id) return res.status(500).json({ ok: false, error: "NO_MAIN_TEMPLATE_FOR_ASPECT", aspectRatio });

        // MUST have narration stored (recommended: choices.narration in create-video.js)
        const narration = String(choices.narration || row.narration || "").trim();
        if (!narration) return res.status(500).json({ ok: false, error: "MISSING_NARRATION_FOR_RERENDER" });

        // Build minimal mods (matches your create-video.js labels)
        const mods = {
          Narration: narration,
          Voiceover: narration,
          VoiceLabel: choices.voice || "Adam",
          LanguageLabel: choices.language || "English",
          StoryTypeLabel: choices.storyType || "Video",
          ...subtitleVisibilityMods(styleSafe),
        };

        const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
        const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(row.id)}&kind=main`;

        const payload = { template_id, modifications: mods, output_format: "mp4", webhook_url };

        const resp = await postJSON(
          "https://api.creatomate.com/v1/renders",
          { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
          payload
        );

        if (resp.status !== 202 && resp.status !== 200) {
          return res.status(resp.status).json({ ok: false, error: "CREATOMATE_ERROR", details: resp.json });
        }

        const newRenderId = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
        if (!newRenderId) return res.status(502).json({ ok: false, error: "NO_JOB_ID", details: resp.json });

        // Force the UI to wait for the new output (webhook will set video_url)
        await sb.from("renders").update({
          status: "rendering",
          render_id: String(newRenderId),
          video_url: null,
          // Keep everything, just update the style + narration (so it’s always present)
          choices: { ...choices, captionStyle: styleSafe, narration },
        }).eq("id", row.id);

        return res.status(200).json({
          ok: true,
          id: row.id,
          render_id: newRenderId,
          status: "rendering",
          captionStyle: styleSafe,
        });
      }

      // ==========================================================
      // captions-apply  ✅ make a captioned COPY via captions template
      // (kept for optional “export captioned version” flow)
      // ==========================================================
      if (action === "captions-apply") {
        const id = String(body?.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

        const style = String(body?.style || "sentence").trim().toLowerCase();
        const styleSafe = ["sentence", "karaoke", "word"].includes(style) ? style : "sentence";

        if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });

        const { data: row, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

        const prevStyle = String(row.caption_style || "").trim().toLowerCase();
        if (row.captioned_video_url && prevStyle === styleSafe) {
          return res.status(200).json({
            ok: true,
            already: true,
            caption_status: row.caption_status || "completed",
            captioned_video_url: row.captioned_video_url,
            style: styleSafe,
          });
        }

        const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
        const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);
        if (!template_id) return res.status(500).json({ ok: false, error: "MISSING_CAPTIONS_TEMPLATE" });

        await sb
          .from("renders")
          .update({
            caption_status: "captioning",
            caption_error: null,
            captioned_video_url: null,
            caption_template_id: `creatomate:${template_id}`,
            caption_style: styleSafe,
          })
          .eq("id", row.id);

        const mods = {
          [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),
          ...subtitleVisibilityMods(styleSafe),
        };

        // Optional element exists in some caption templates
        mods[`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`] = "";

        const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
        const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(row.id)}&kind=caption`;

        const payload = { template_id, modifications: mods, output_format: "mp4", webhook_url };

        const resp = await postJSON(
          "https://api.creatomate.com/v1/renders",
          { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
          payload
        );

        if (resp.status !== 202 && resp.status !== 200) {
          await sb
            .from("renders")
            .update({ caption_status: "failed", caption_error: JSON.stringify(resp.json) })
            .eq("id", row.id);

          return res.status(resp.status).json({ ok: false, error: "CREATOMATE_ERROR", details: resp.json });
        }

        // You DO NOT have caption_render_id column — do not write it.
        return res.status(200).json({
          ok: true,
          id: row.id,
          caption_status: "captioning",
          style: styleSafe,
        });
      }

      return res.status(400).json({ ok: false, error: "UNKNOWN_ACTION" });
    }

    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (err) {
    const msg = String(err?.message || err);

    if (msg.includes("MISSING_AUTH") || msg.includes("MEMBERSTACK") || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: msg });
    }

    console.error("[RENDERS] SERVER_ERROR", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: msg });
  }
};
