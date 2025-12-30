// api/renders.js (CommonJS, Node 18)
// Handles:
// - GET  /api/renders        -> list renders for member
// - GET  /api/renders?id=... -> single render
// - POST /api/renders { action:"captions-apply", id, style } -> create captions render

const https = require("https");
const { getAdminSupabase } = require("./_lib/supabase");
const memberstackAdmin = require("@memberstack/admin");

const API_BASE = (process.env.API_BASE || "").trim(); // MUST be your public vercel URL
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

// ---------- CORS ----------
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

  // IMPORTANT: include GET for your list page
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// ---------- Memberstack auth ----------
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

// ---------- Creatomate helper ----------
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

// ---------- Captions template picking ----------
// Put these in Vercel env vars:
// CREATO_CAPTIONS_TEMPLATE_916, CREATO_CAPTIONS_TEMPLATE_11, CREATO_CAPTIONS_TEMPLATE_169
function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "9:16").trim();
  const map = {
    "9:16": (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim(),
    "1:1": (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim(),
    "16:9": (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim(),
  };
  return map[ar] || "";
}

// These MUST match your captions template element IDs in Creatomate
// Example: your template has a video element and optionally captions element.
// If your captions are auto-transcribed from the video element, you only need VIDEO element.
const CREATO_VIDEO_ELEMENT_ID = (process.env.CREATO_VIDEO_ELEMENT_ID || "Video-DHM").trim();
// If you have a captions JSON/text element, set it; otherwise it will be ignored.
const CREATO_CAPTIONS_JSON_ELEMENT_ID = (process.env.CREATO_CAPTIONS_JSON_ELEMENT_ID || "Subtitles-1").trim();

// Optional: if you use 3 caption layers:
function subtitleVisibilityMods(style) {
  const s = String(style || "sentence").toLowerCase();
  const threeLayer = {
    "Subtitles_Sentence.visible": false,
    "Subtitles_Karaoke.visible": false,
    "Subtitles_Word.visible": false,
  };

  if (s === "word") threeLayer["Subtitles_Word.visible"] = true;
  else if (s === "karaoke") threeLayer["Subtitles_Karaoke.visible"] = true;
  else threeLayer["Subtitles_Sentence.visible"] = true;

  // single layer fallback
  const singleLayerFallback = { "Subtitles-1.visible": true };

  return { ...threeLayer, ...singleLayerFallback };
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

// ---------- MAIN ----------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    // ---------- GET ----------
    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();

      if (id) {
        const { data, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !data) return json(res, 404, { ok: false, error: "NOT_FOUND" });

        // If video_url exists, treat status as succeeded for UI stability
        if (data.video_url && String(data.status || "").toLowerCase() !== "failed") {
          data.status = "succeeded";
        }

        return json(res, 200, { ok: true, item: data });
      }

      const { data, error } = await sb
        .from("renders")
        .select("*")
        .eq("member_id", member_id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) return json(res, 500, { ok: false, error: "DB_READ_FAILED", details: error });

      // Normalize status so your UI doesn't get stuck "rendering" if URL exists
      const items = (data || []).map((r) => {
        if (r.video_url && String(r.status || "").toLowerCase() !== "failed") {
          return { ...r, status: "succeeded" };
        }
        return r;
      });

      return json(res, 200, { ok: true, items });
    }

    // ---------- POST ----------
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const action = String(body?.action || "").trim();

    // ---------------- captions-apply ----------------
    if (action === "captions-apply") {
      const id = String(body?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "MISSING_ID" });

      const style = String(body?.style || "").trim() || "sentence";

      if (!CREATOMATE_API_KEY) return json(res, 500, { ok: false, error: "MISSING_CREATOMATE_API_KEY" });

      const { data: row, error } = await sb
        .from("renders")
        .select("*")
        .eq("id", id)
        .eq("member_id", member_id)
        .single();

      if (error || !row) return json(res, 404, { ok: false, error: "NOT_FOUND" });
      if (!row.video_url) return json(res, 400, { ok: false, error: "VIDEO_NOT_READY" });

      // If we already have captioned URL, don’t re-render.
      if (row.captioned_video_url) {
        return json(res, 200, {
          ok: true,
          already: true,
          status: row.caption_status || "completed",
          captioned_video_url: row.captioned_video_url,
        });
      }

      // If a caption render is already in progress, don’t start another.
      if (String(row.caption_status || "").toLowerCase() === "captioning" && row.caption_render_id) {
        return json(res, 200, {
          ok: true,
          already: true,
          status: "captioning",
          caption_render_id: row.caption_render_id,
        });
      }

      const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
      const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);
      if (!template_id) return json(res, 500, { ok: false, error: "MISSING_CAPTIONS_TEMPLATE" });

      // Mark captioning started immediately
      await sb
        .from("renders")
        .update({
          caption_status: "captioning",
          caption_error: null,
          caption_template_id: `creatomate:${template_id}`,
          // IMPORTANT: clear these so UI doesn't think stale data is valid
          captioned_video_url: null,
          caption_render_id: null,
        })
        .eq("id", row.id);

      // Build modifications for captions template
      // (Video element points at the existing finished video)
      const mods = {
        [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),
        ...subtitleVisibilityMods(style),
      };

      // If you have a captions text/json element, you can optionally set it
      // (Leaving it blank is fine if Creatomate auto-transcribes)
      mods[`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`] = "";

      const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();

      // ✅ THIS IS THE CRITICAL FIX:
      // webhook_url MUST include ?id=<db row id>
      const payload = {
        template_id,
        modifications: mods,
        output_format: "mp4",
        webhook_url: `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(row.id)}&kind=caption`,
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

        return json(res, resp.status, { ok: false, error: "CREATOMATE_ERROR", details: resp.json });
      }

      const job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
      if (!job_id) {
        await sb
          .from("renders")
          .update({
            caption_status: "failed",
            caption_error: "NO_CAPTION_JOB_ID",
          })
          .eq("id", row.id);

        return json(res, 502, { ok: false, error: "NO_JOB_ID_IN_RESPONSE", details: resp.json });
      }

      // ✅ SAVE caption render id so webhook can match it
      await sb
        .from("renders")
        .update({
          caption_render_id: String(job_id),
          caption_status: "captioning",
        })
        .eq("id", row.id);

      return json(res, 200, {
        ok: true,
        caption_status: "captioning",
        caption_render_id: String(job_id),
        style,
      });
    }

    return json(res, 400, { ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    const msg = String(err?.message || err);

    if (
      msg.includes("MISSING_AUTH") ||
      msg.includes("MEMBERSTACK") ||
      msg.includes("INVALID_MEMBER")
    ) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED", message: msg });
    }

    console.error("[RENDERS] SERVER_ERROR", err);
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: msg });
  }
};
