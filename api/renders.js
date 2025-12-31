// api/renders.js (CommonJS, Node 18 on Vercel)
// Handles:
//  - GET /api/renders            => list renders for member
//  - GET /api/renders?id=...     => single render for member
//  - POST /api/renders {action:"captions-apply", id, style} => start captions render in Creatomate

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

// -------------------- CORS --------------------
// Use ALLOW_ORIGINS for comma-separated allowlist.
// Example: https://nofacelabsai.webflow.io,https://nofacelabs.ai
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    // If you use credentials cookies, don't use "*".
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

// If you have dedicated captions templates by aspect ratio:
const CAPTIONS_TEMPLATE_916 = (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim();
const CAPTIONS_TEMPLATE_11 = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

// These are the element IDs inside your *captions template*
const CREATO_VIDEO_ELEMENT_ID = (process.env.CREATO_VIDEO_ELEMENT_ID || "Video-DHM").trim();
// Optional (if your captions template expects some text element, you can leave it blank)
const CREATO_CAPTIONS_JSON_ELEMENT_ID = (process.env.CREATO_CAPTIONS_JSON_ELEMENT_ID || "Subtitles-1").trim();

// This must be public for Creatomate to call your webhook
const API_BASE = (process.env.API_BASE || "").trim();

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

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

// -------------------- MAIN --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  // ✅ Always answer preflight (this is what was blocking you in Webflow)
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

      // ---------- captions-apply ----------
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

// already done? only if same style
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

        // if a caption exists but style changed, regenerate (overwrite)


        const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
        const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);
        if (!template_id) return res.status(500).json({ ok: false, error: "MISSING_CAPTIONS_TEMPLATE" });

        // Put DB into captioning state BEFORE calling Creatomate
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

        // Template modifications: pipe original video into the captions template
        const mods = {
          [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),
        };

        // Some templates include a subtitle layer you want forced visible.
        // If your template uses the 3-layer method, your template itself should
        // switch based on style or you can do it here.
        // (Safe: extra keys won't break if layer not found.)
        mods["Subtitles_Sentence.visible"] = styleSafe === "sentence";
        mods["Subtitles_Karaoke.visible"] = styleSafe === "karaoke";
        mods["Subtitles_Word.visible"] = styleSafe === "word";
        mods["Subtitles-1.visible"] = true; // fallback

        // If you have a text element that must exist, set it to empty (safe)
        mods[`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`] = "";

        const publicBaseUrl = API_BASE || `https://${req.headers.host}`;

        // ✅ WEBHOOK URL includes db row id AND kind=caption
        const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(
          row.id
        )}&kind=caption`;

        const payload = {
          template_id,
          modifications: mods,
          output_format: "mp4",
          webhook_url,
        };

        const resp = await postJSON(
          "https://api.creatomate.com/v1/renders",
          { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
          payload
        );

        if (resp.status !== 202 && resp.status !== 200) {
          await sb
            .from("renders")
            .update({
              caption_status: "failed",
              caption_error: JSON.stringify(resp.json),
            })
            .eq("id", row.id);

          return res.status(resp.status).json({ ok: false, error: "CREATOMATE_ERROR", details: resp.json });
        }

        const caption_render_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
        if (!caption_render_id) {
          await sb
            .from("renders")
            .update({
              caption_status: "failed",
              caption_error: "NO_CAPTION_JOB_ID",
            })
            .eq("id", row.id);

          return res.status(502).json({ ok: false, error: "NO_CAPTION_JOB_ID", details: resp.json });
        }

        await sb
          .from("renders")
          .update({
            caption_render_id: String(caption_render_id),
            caption_status: "captioning",
          })
          .eq("id", row.id);

        return res.status(200).json({
          ok: true,
          id: row.id,
          caption_render_id,
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
