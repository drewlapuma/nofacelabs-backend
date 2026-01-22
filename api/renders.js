// api/renders.js (CommonJS, Node 18 on Vercel)
// Handles:
//  - GET    /api/renders                 => list renders for member
//  - GET    /api/renders?id=...          => single render for member
//  - DELETE /api/renders?id=...          => delete render for member (DB + voiceover mp3)
//  - POST   /api/renders {action:"delete", id}  => delete fallback (same behavior)
//
// ✅ NOTE: captions endpoints kept (so nothing breaks elsewhere) but your /myvideos page no longer uses them.
// ✅ NOTE: This deletes ONLY:
//    - the "renders" row
//    - the voiceover mp3 in Supabase Storage (VOICE_BUCKET) at `${id}/voice.mp3`
// If you also store MP4s somewhere, tell me where and I’ll add that deletion too.

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

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// -------------------- Memberstack auth --------------------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isExpiredJwtError(err) {
  const code = err?.code;
  const msg = String(err?.message || "").toLowerCase();

  // jose-style + common variants
  if (code === "ERR_JWT_EXPIRED") return true;
  if (msg.includes("jwtexpired") || msg.includes("jwt expired")) return true;
  if (msg.includes('"exp"') && msg.includes("failed")) return true;
  if (msg.includes("token_expired")) return true;

  return false;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) {
    const e = new Error("MISSING_AUTH");
    e.code = "MISSING_AUTH";
    throw e;
  }
  if (!ms) {
    const e = new Error("MISSING_MEMBERSTACK_SECRET_KEY");
    e.code = "MISSING_MEMBERSTACK_SECRET_KEY";
    throw e;
  }

  try {
    const out = await ms.verifyToken({ token });
    const id = out?.id;
    if (!id) {
      const e = new Error("INVALID_MEMBER_TOKEN");
      e.code = "INVALID_MEMBER_TOKEN";
      throw e;
    }
    return String(id);
  } catch (err) {
    if (isExpiredJwtError(err)) {
      const e = new Error("TOKEN_EXPIRED");
      e.code = "TOKEN_EXPIRED";
      throw e;
    }
    throw err;
  }
}

// -------------------- Creatomate (kept) --------------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

const CAPTIONS_TEMPLATE_916 = (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim();
const CAPTIONS_TEMPLATE_11 = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

const CREATO_VIDEO_ELEMENT_ID = (process.env.CREATO_VIDEO_ELEMENT_ID || "Video-DHM").trim();
const CREATO_CAPTIONS_JSON_ELEMENT_ID = (process.env.CREATO_CAPTIONS_JSON_ELEMENT_ID || "Subtitles-1").trim();

const API_BASE = (process.env.API_BASE || "").trim();

// -------------------- Storage cleanup --------------------
const VOICE_BUCKET = (process.env.VOICE_BUCKET || "voiceovers").trim();

function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "9:16").trim();
  if (ar === "9:16") return CAPTIONS_TEMPLATE_916;
  if (ar === "1:1") return CAPTIONS_TEMPLATE_11;
  if (ar === "16:9") return CAPTIONS_TEMPLATE_169;
  return CAPTIONS_TEMPLATE_916 || CAPTIONS_TEMPLATE_11 || CAPTIONS_TEMPLATE_169 || "";
}

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

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function deleteRenderForMember({ sb, member_id, id }) {
  const { data: row, error: readErr } = await sb
    .from("renders")
    .select("*")
    .eq("id", id)
    .eq("member_id", member_id)
    .single();

  if (readErr || !row) return { ok: false, status: 404, error: "NOT_FOUND" };

  // Delete voice file (best-effort)
  try {
    await sb.storage.from(VOICE_BUCKET).remove([`${id}/voice.mp3`]);
  } catch (e) {
    console.error("[RENDERS_DELETE] voice remove failed", { id, message: String(e?.message || e) });
  }

  // Delete DB row
  const { error: delErr } = await sb
    .from("renders")
    .delete()
    .eq("id", id)
    .eq("member_id", member_id);

  if (delErr) {
    console.error("[RENDERS_DELETE] DB delete failed", { id, delErr });
    return { ok: false, status: 500, error: "DB_DELETE_FAILED", details: delErr };
  }

  return { ok: true, status: 200, deleted_id: id };
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

    // ---------------- DELETE ----------------
    if (req.method === "DELETE") {
      const id = String(req.query?.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

      const out = await deleteRenderForMember({ sb, member_id, id });
      return res.status(out.status).json(out.ok ? { ok: true, id: out.deleted_id } : out);
    }

    // ---------------- POST ----------------
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? safeJsonParse(req.body) || {} : req.body || {};
      const action = String(body?.action || "").trim();

      // ✅ delete fallback
      if (action === "delete") {
        const id = String(body?.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

        const out = await deleteRenderForMember({ sb, member_id, id });
        return res.status(out.status).json(out.ok ? { ok: true, id: out.deleted_id } : out);
      }

      // ---------- captions-apply (kept) ----------
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

        const prevStyle = String(row?.choices?.captionStyle || row?.choices?.caption_style || "").trim().toLowerCase();

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

        const newChoices = { ...(row.choices || {}), captionStyle: styleSafe };

        await sb
          .from("renders")
          .update({
            caption_status: "captioning",
            caption_error: null,
            captioned_video_url: null,
            caption_template_id: `creatomate:${template_id}`,
            choices: newChoices,
          })
          .eq("id", row.id);

        const mods = {
          [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),
        };

        // hide all known variants
        mods["Subtitles_Sentence.visible"] = false;
        mods["Subtitles_Karaoke.visible"] = false;
        mods["Subtitles_Word.visible"] = false;
        mods["Subtitles-1.visible"] = false;

        if (styleSafe === "karaoke") mods["Subtitles_Karaoke.visible"] = true;
        else if (styleSafe === "word") mods["Subtitles_Word.visible"] = true;
        else mods["Subtitles_Sentence.visible"] = true;

        mods[`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`] = "";

        const publicBaseUrl = API_BASE || `https://${req.headers.host}`;
        const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(row.id)}&kind=caption`;

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

        const caption_job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
        if (!caption_job_id) {
          await sb
            .from("renders")
            .update({
              caption_status: "failed",
              caption_error: "NO_CAPTION_JOB_ID",
            })
            .eq("id", row.id);

          return res.status(502).json({ ok: false, error: "NO_CAPTION_JOB_ID", details: resp.json });
        }

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
    const code = err?.code;

    // ✅ Expired tokens = 401 (not 500)
    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) {
      return res.status(401).json({
        ok: false,
        error: "TOKEN_EXPIRED",
        message: "Session expired. Refresh the page and try again.",
      });
    }

    if (code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) {
      return res.status(401).json({ ok: false, error: "MISSING_AUTH" });
    }

    if (code === "INVALID_MEMBER_TOKEN" || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ ok: false, error: "INVALID_MEMBER_TOKEN" });
    }

    if (code === "MISSING_MEMBERSTACK_SECRET_KEY") {
      return res.status(500).json({ ok: false, error: "MISSING_MEMBERSTACK_SECRET_KEY" });
    }

    console.error("[RENDERS] SERVER_ERROR", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: msg });
  }
};
