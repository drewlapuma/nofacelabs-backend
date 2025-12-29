// api/renders.js (CommonJS)
// GET  /api/renders             => list
// GET  /api/renders?id=<uuid>   => single (lazy-polls Creatomate/Submagic when captioning)
// POST /api/renders             => captions-start (Submagic) OR captions-apply (Creatomate)

const https = require("https");
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

// ---------------- Submagic ----------------
const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

// ---------------- Creatomate captions ----------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

// ✅ Your captions template id (hardcoded)
const CREATO_CAPTIONS_TEMPLATE_916 = "f956ac82-b070-4fc7-9056-78bea778a301";

// Optional future templates
const CREATO_CAPTIONS_TEMPLATE_11 = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CREATO_CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

// ✅ Template element ids (from your screenshot)
// IMPORTANT: these must match the left panel names in Creatomate exactly
const CREATO_VIDEO_ELEMENT_ID = "Video-DHM"; // use: Video-DHM.source
const CREATO_SUB_SENTENCE_ID = "Subtitles_Sentence";
const CREATO_SUB_KARAOKE_ID = "Subtitles_Karaoke";
const CREATO_SUB_WORD_ID = "Subtitles_Word";

// If you keep a JSON text layer and want to blank it:
const CREATO_CAPTIONS_JSON_ELEMENT_ID = "a06990b5-eb94-4792-984a-2fdf21c29407"; // Captions_JSON.text

// ---------------- CORS ----------------
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  // If "*" allow all (no credentials). Best for Bearer auth.
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

// ---------------- helpers ----------------
function pickTemplate(body) {
  return String(
    body?.templateId ||
      body?.template_id ||
      body?.templateName ||
      body?.template_name ||
      body?.template ||
      body?.style ||
      body?.preset ||
      ""
  ).trim();
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "completed";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("caption") || x.includes("render")) return "captioning";
  return x;
}

function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "").trim();
  if (ar === "1:1" && CREATO_CAPTIONS_TEMPLATE_11) return CREATO_CAPTIONS_TEMPLATE_11;
  if (ar === "16:9" && CREATO_CAPTIONS_TEMPLATE_169) return CREATO_CAPTIONS_TEMPLATE_169;
  // fallback to your hardcoded 9:16 template
  return CREATO_CAPTIONS_TEMPLATE_916;
}

// --- HTTPS JSON helper (Creatomate POST) ---
function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(bodyObj);

    const req2 = https.request(
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
      (resp) => {
        let buf = "";
        resp.setEncoding("utf8");
        resp.on("data", (chunk) => (buf += chunk));
        resp.on("end", () => {
          try {
            resolve({ status: resp.statusCode, json: JSON.parse(buf || "{}") });
          } catch {
            resolve({ status: resp.statusCode, json: { raw: buf } });
          }
        });
      }
    );

    req2.on("error", reject);
    req2.write(data);
    req2.end();
  });
}

// ---- Submagic helpers (kept for backward compatibility) ----
async function smCreateProject({ templateName, videoUrl, title, language = "en" }) {
  if (!SUBMAGIC_API_KEY) throw new Error("MISSING_SUBMAGIC_API_KEY");

  const r = await fetch(`${SUBMAGIC_BASE}/projects`, {
    method: "POST",
    headers: { "x-api-key": SUBMAGIC_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ title, language, videoUrl, templateName: templateName || undefined }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_CREATE_FAILED (${r.status})`);
  return j;
}

async function smGetProject(projectId) {
  if (!SUBMAGIC_API_KEY) throw new Error("MISSING_SUBMAGIC_API_KEY");

  const r = await fetch(`${SUBMAGIC_BASE}/projects/${encodeURIComponent(projectId)}`, {
    headers: { "x-api-key": SUBMAGIC_API_KEY },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `SUBMAGIC_GET_FAILED (${r.status})`);
  return j;
}

// ---- Creatomate GET render status/output ----
async function creatomateGetRender(renderId) {
  if (!CREATOMATE_API_KEY) throw new Error("MISSING_CREATOMATE_API_KEY");

  const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`, {
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `CREATOMATE_GET_FAILED (${r.status})`);
  return j;
}

function extractCreatomateOutputUrl(renderObj) {
  return (
    renderObj?.output ||
    renderObj?.url ||
    renderObj?.video_url ||
    (Array.isArray(renderObj?.outputs)
      ? renderObj.outputs[0]?.url || renderObj.outputs[0]?.output
      : null) ||
    null
  );
}

// ---------------- MAIN ----------------
module.exports = async function handler(req, res) {
  // ✅ CORS MUST ALWAYS RUN FIRST (even if auth/db fails)
  setCors(req, res);

  // ✅ Preflight must always succeed
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const sb = getAdminSupabase();

    // ---------------- GET ----------------
    if (req.method === "GET") {
      const member_id = await requireMemberId(req);
      const id = String(req.query?.id || "").trim();

      // ---- single ----
      if (id) {
        let { data, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !data) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

        // ✅ Lazy-poll Creatomate caption render
        try {
          const capStatus = String(data.caption_status || "").toLowerCase();
          const isCaptioning =
            capStatus === "captioning" ||
            capStatus === "processing" ||
            capStatus === "queued" ||
            capStatus === "rendering";

          const captionRenderId =
            String(data.caption_render_id || "") ||
            String(data?.choices?.caption_render_id || "");

          if (captionRenderId && !data.captioned_video_url && isCaptioning) {
            const rObj = await creatomateGetRender(captionRenderId);
            const rStatus = normStatus(rObj?.status || "");
            const outUrl = extractCreatomateOutputUrl(rObj);

            if (outUrl && rStatus === "completed") {
              const { data: updated } = await sb
                .from("renders")
                .update({
                  caption_status: "completed",
                  captioned_video_url: String(outUrl),
                  caption_error: null,
                })
                .eq("id", data.id)
                .select("*")
                .single();

              if (updated) data = updated;
            } else if (rStatus) {
              await sb.from("renders").update({ caption_status: rStatus }).eq("id", data.id);
              data.caption_status = rStatus;
            }
          }
        } catch (pollCapErr) {
          await sb
            .from("renders")
            .update({
              caption_status: "failed",
              caption_error: String(pollCapErr?.message || pollCapErr),
            })
            .eq("id", data.id);

          data.caption_status = "failed";
          data.caption_error = String(pollCapErr?.message || pollCapErr);
        }

        // ✅ Lazy-poll Submagic (legacy)
        try {
          const capStatus2 = String(data.caption_status || "").toLowerCase();
          const isCaptioning2 =
            capStatus2 === "captioning" || capStatus2 === "processing" || capStatus2 === "queued";

          if (data.submagic_project_id && !data.captioned_video_url && isCaptioning2) {
            const proj = await smGetProject(data.submagic_project_id);
            const downloadUrl = proj?.downloadUrl || proj?.directUrl || proj?.export?.downloadUrl || "";
            const projStatus = normStatus(proj?.status || "captioning");

            if (downloadUrl) {
              const { data: updated } = await sb
                .from("renders")
                .update({
                  caption_status: "completed",
                  captioned_video_url: String(downloadUrl),
                  caption_error: null,
                })
                .eq("id", data.id)
                .select("*")
                .single();

              if (updated) data = updated;
            } else if (projStatus) {
              await sb.from("renders").update({ caption_status: projStatus }).eq("id", data.id);
            }
          }
        } catch (pollErr) {
          await sb
            .from("renders")
            .update({
              caption_status: "failed",
              caption_error: String(pollErr?.message || pollErr),
            })
            .eq("id", data.id);

          data.caption_status = "failed";
          data.caption_error = String(pollErr?.message || pollErr);
        }

        return res.status(200).json({ ok: true, item: data });
      }

      // ---- list ----
      const { data, error } = await sb
        .from("renders")
        .select("*")
        .eq("member_id", member_id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) return res.status(500).json({ ok: false, error: "SUPABASE_LIST_FAILED" });
      return res.status(200).json({ ok: true, items: data || [] });
    }

    // ---------------- POST ----------------
    if (req.method === "POST") {
      const member_id = await requireMemberId(req);

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const action = String(body?.action || "").trim();

      // =========================================================
      // ACTION 1: captions-start (Submagic)
      // =========================================================
      if (action === "captions-start") {
        const id = String(body?.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

        const templateName = pickTemplate(body);

        const { data: row, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

        if (row.captioned_video_url) {
          return res.status(200).json({
            ok: true,
            already: true,
            status: "completed",
            captioned_video_url: row.captioned_video_url,
          });
        }

        if (row.submagic_project_id) {
          return res.status(200).json({
            ok: true,
            already: true,
            projectId: row.submagic_project_id,
            status: row.caption_status || "captioning",
          });
        }

        await sb
          .from("renders")
          .update({
            caption_status: "captioning",
            caption_error: null,
            caption_template_id: templateName || null,
          })
          .eq("id", row.id);

        const title = row?.choices?.storyType || row?.choices?.customPrompt || "NofaceLabs Video";

        const created = await smCreateProject({
          templateName,
          videoUrl: row.video_url,
          title,
          language: "en",
        });

        const projectId = created?.id || created?.projectId || created?.project_id;
        if (!projectId) throw new Error("SUBMAGIC_NO_PROJECT_ID");

        await sb
          .from("renders")
          .update({
            submagic_project_id: String(projectId),
            caption_status: normStatus(created?.status || "captioning"),
            caption_error: null,
          })
          .eq("id", row.id);

        return res.status(200).json({ ok: true, already: false, projectId: String(projectId) });
      }

      // =========================================================
      // ACTION 2: captions-apply (Creatomate captions render)
      // =========================================================
      if (action === "captions-apply") {
        const id = String(body?.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "MISSING_ID" });

        const style = String(body?.style || "").trim().toLowerCase() || "sentence"; // sentence|karaoke|word
        if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });

        const { data: row, error } = await sb
          .from("renders")
          .select("*")
          .eq("id", id)
          .eq("member_id", member_id)
          .single();

        if (error || !row) return res.status(404).json({ ok: false, error: "NOT_FOUND" });
        if (!row.video_url) return res.status(400).json({ ok: false, error: "VIDEO_NOT_READY" });

        // If already captioned, return it
        if (row.captioned_video_url) {
          return res.status(200).json({
            ok: true,
            already: true,
            status: row.caption_status || "completed",
            captioned_video_url: row.captioned_video_url,
          });
        }

        const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
        const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);

        if (!template_id) {
          return res.status(500).json({
            ok: false,
            error: "MISSING_CAPTIONS_TEMPLATE",
            message: "Captions template id missing.",
          });
        }

        // Mark captioning started
        await sb
          .from("renders")
          .update({
            caption_status: "captioning",
            caption_error: null,
            caption_template_id: `creatomate:${template_id}`,
          })
          .eq("id", row.id);

        // ✅ Force ONLY ONE subtitle layer visible
        const showSentence = style === "sentence";
        const showKaraoke = style === "karaoke";
        const showWord = style === "word";

        // Creatomate supports element property modifications like .opacity and .visible.
        // We set BOTH to be safe.
        const mods = {
          // video source
          [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),

          // hide/show subtitle tracks
          [`${CREATO_SUB_SENTENCE_ID}.visible`]: showSentence,
          [`${CREATO_SUB_KARAOKE_ID}.visible`]: showKaraoke,
          [`${CREATO_SUB_WORD_ID}.visible`]: showWord,

          [`${CREATO_SUB_SENTENCE_ID}.opacity`]: showSentence ? 100 : 0,
          [`${CREATO_SUB_KARAOKE_ID}.opacity`]: showKaraoke ? 100 : 0,
          [`${CREATO_SUB_WORD_ID}.opacity`]: showWord ? 100 : 0,
        };

        // Optional: blank any leftover “Your text here” JSON layer if it exists
        // (won't hurt if it doesn't exist)
        mods[`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`] = "";

        const payload = {
          template_id,
          modifications: mods,
          output_format: "mp4",
        };

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

        const caption_render_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;
        if (!caption_render_id) {
          await sb
            .from("renders")
            .update({ caption_status: "failed", caption_error: "NO_CAPTION_RENDER_ID" })
            .eq("id", row.id);

          return res.status(502).json({ ok: false, error: "NO_CAPTION_RENDER_ID", details: resp.json });
        }

        // Store caption render id + chosen style
        try {
          await sb
            .from("renders")
            .update({
              caption_render_id: String(caption_render_id),
              caption_status: "captioning",
              caption_error: null,
            })
            .eq("id", row.id);
        } catch {
          const merged = {
            ...(row.choices || {}),
            caption_render_id: String(caption_render_id),
            captionStyle: style,
          };
          await sb
            .from("renders")
            .update({
              choices: merged,
              caption_status: "captioning",
              caption_error: null,
            })
            .eq("id", row.id);
        }

        return res.status(200).json({
          ok: true,
          already: false,
          caption_render_id: String(caption_render_id),
          status: "captioning",
        });
      }

      return res.status(400).json({ ok: false, error: "BAD_ACTION" });
    }

    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (fatal) {
    // ✅ Still returns CORS headers because setCors ran before try/catch
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(fatal?.message || fatal) });
  }
};
