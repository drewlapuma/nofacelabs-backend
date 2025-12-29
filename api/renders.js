// api/renders.js (CommonJS)
// GET  /api/renders             => list
// GET  /api/renders?id=<uuid>   => single (lazy polls Creatomate caption render OR Submagic)
// POST /api/renders             => { action:"captions-start" } (Submagic) OR { action:"captions-apply" } (Creatomate captions)

const https = require("https");
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

// ---------------- Submagic ----------------
const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

// ---------------- Creatomate captions ----------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

// ✅ Your captions template (9:16) — you gave this
const FORCE_CAPTIONS_TEMPLATE_916 = "f956ac82-b070-4fc7-9056-78bea778a301";

// Optional env-based templates (if you want to support 1:1 and 16:9 later)
const CREATO_CAPTIONS_TEMPLATE_916 = (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim();
const CREATO_CAPTIONS_TEMPLATE_11 = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CREATO_CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

// ---------------- CORS ----------------
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

  // ✅ force 9:16 to your known-good template id
  if (ar === "9:16") return FORCE_CAPTIONS_TEMPLATE_916;

  // optional support if you set these envs:
  if (ar === "1:1") return CREATO_CAPTIONS_TEMPLATE_11 || FORCE_CAPTIONS_TEMPLATE_916;
  if (ar === "16:9") return CREATO_CAPTIONS_TEMPLATE_169 || FORCE_CAPTIONS_TEMPLATE_916;

  // fallback
  return CREATO_CAPTIONS_TEMPLATE_916 || FORCE_CAPTIONS_TEMPLATE_916;
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

// ---------------- Submagic helpers ----------------
async function smCreateProject({ templateName, videoUrl, title, language = "en" }) {
  if (!SUBMAGIC_API_KEY) throw new Error("MISSING_SUBMAGIC_API_KEY");

  const r = await fetch(`${SUBMAGIC_BASE}/projects`, {
    method: "POST",
    headers: {
      "x-api-key": SUBMAGIC_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      language,
      videoUrl,
      templateName: templateName || undefined,
    }),
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

// ---------------- Creatomate helpers ----------------
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
    (Array.isArray(renderObj?.outputs) ? (renderObj.outputs[0]?.url || renderObj.outputs[0]?.output) : null) ||
    null
  );
}

module.exports = async function handler(req, res) {
  try {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();

    const sb = getAdminSupabase();

    // This must be publicly reachable for Creatomate webhooks
    const publicBaseUrl = (process.env.API_BASE || "").trim() || `https://${req.headers.host}`;

    // ---------------- GET ----------------
    if (req.method === "GET") {
      try {
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

          // ✅ LAZY POLL (1): Creatomate caption render (if caption_render_id exists)
          try {
            const capStatus = String(data.caption_status || "").toLowerCase();
            const isCaptioning =
              capStatus === "captioning" || capStatus === "processing" || capStatus === "queued" || capStatus === "rendering";

            const captionRenderId =
              String(data.caption_render_id || "").trim() ||
              String(data?.choices?.caption_render_id || "").trim();

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

          // ✅ LAZY POLL (2): Submagic (backward compatibility)
          try {
            const capStatus2 = String(data.caption_status || "").toLowerCase();
            const isCaptioning2 = capStatus2 === "captioning" || capStatus2 === "processing" || capStatus2 === "queued";

            if (data.submagic_project_id && !data.captioned_video_url && isCaptioning2) {
              const proj = await smGetProject(data.submagic_project_id);
              const downloadUrl = proj?.downloadUrl || proj?.directUrl || "";
              const projStatus = String(proj?.status || "captioning");

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
              } else {
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
      } catch (e) {
        return res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: String(e?.message || e) });
      }
    }

    // ---------------- POST ----------------
    if (req.method === "POST") {
      try {
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
              caption_status: String(created?.status || "captioning"),
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

          const style = String(body?.style || "").trim() || "sentence"; // sentence|highlight|karaoke|word
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

          // Determine template by aspect ratio (stored in choices)
          const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
          const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);

          if (!template_id) {
            return res.status(500).json({
              ok: false,
              error: "MISSING_CAPTIONS_TEMPLATE",
              message: "Missing captions template id.",
            });
          }

          // Mark captioning started (also store style so UI can show it)
          await sb
            .from("renders")
            .update({
              caption_status: "captioning",
              caption_error: null,
              caption_template_id: `creatomate:${template_id}`,
              // If you have a caption_style column, keep it. If not, this is harmless.
              caption_style: style,
            })
            .eq("id", row.id);

          // IMPORTANT:
          // These IDs MUST match your Creatomate captions template element IDs.
          // From your screenshot: "Subtitles-1" and "Video-DHM"
          const mods = {
            "Video-DHM.source": String(row.video_url),

            // Optional: if you add a dynamic text/layer to drive style, you can pass it here
            // "CaptionStyle.text": style,
          };

          // Kick off a Creatomate render (mp4) + webhook that updates the SAME row
          const payload = {
            template_id,
            modifications: mods,
            output_format: "mp4",
            webhook_url: `${publicBaseUrl}/api/creatomate-webhook?db_id=${encodeURIComponent(row.id)}&kind=captions`,
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
                caption_error: "NO_CAPTION_RENDER_ID",
              })
              .eq("id", row.id);

            return res.status(502).json({ ok: false, error: "NO_CAPTION_RENDER_ID", details: resp.json });
          }

          // Store caption render id (column if present; fallback to choices)
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
              caption_style: style,
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
      } catch (e) {
        return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
      }
    }

    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  } catch (fatal) {
    return res.status(500).json({ ok: false, error: "FATAL", message: String(fatal?.message || fatal) });
  }
};
