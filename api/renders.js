// api/renders.js (CommonJS)
// GET  /api/renders             => list (lazy-polls MAIN Creatomate renders that are stuck)
// GET  /api/renders?id=<uuid>   => single (lazy-polls MAIN + captions + Submagic)
// POST /api/renders             => captions-start (Submagic) OR captions-apply (Creatomate)

const https = require("https");
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

// ---------------- Submagic ----------------
const SUBMAGIC_API_KEY = (process.env.SUBMAGIC_API_KEY || "").trim();
const SUBMAGIC_BASE = "https://api.submagic.co/v1";

// ---------------- Creatomate ----------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

// ✅ hardcode your 9:16 captions template
const CREATO_CAPTIONS_TEMPLATE_916 = "f956ac82-b070-4fc7-9056-78bea778a301";
const CREATO_CAPTIONS_TEMPLATE_11 = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CREATO_CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

// element ids from your template
const CREATO_VIDEO_ELEMENT_ID = "Video-DHM"; // Video-DHM.source
const CREATO_CAPTIONS_JSON_ELEMENT_ID = "a06990b5-eb94-4792-984a-2fdf21c29407"; // Captions_JSON.text

// ✅ subtitle layer names from your template (these MUST match exactly)
const CREATO_SUB_SENTENCE = "Subtitles_Sentence";
const CREATO_SUB_KARAOKE = "Subtitles_Karaoke";
const CREATO_SUB_WORD = "Subtitles_Word";

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

  // ✅ treat Creatomate "waiting" as pending
  if (x.includes("wait") || x.includes("plan")) return "rendering";

  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("caption")) return "rendering";
  return x;
}

function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "").trim();
  if (ar === "1:1" && CREATO_CAPTIONS_TEMPLATE_11) return CREATO_CAPTIONS_TEMPLATE_11;
  if (ar === "16:9" && CREATO_CAPTIONS_TEMPLATE_169) return CREATO_CAPTIONS_TEMPLATE_169;
  return CREATO_CAPTIONS_TEMPLATE_916;
}

// --- HTTPS JSON helper (kept like your style) ---
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

// ---------------- Submagic API ----------------
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

// ---------------- Creatomate API ----------------
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
      ? (renderObj.outputs[0]?.url || renderObj.outputs[0]?.output)
      : null) ||
    null
  );
}

async function lazyPollMainRender({ sb, row }) {
  const videoUrl = String(row?.video_url || "");
  if (videoUrl) return row;

  const status = normStatus(row?.status || "");
  // ✅ now "waiting" becomes "rendering" and WILL poll
  if (status !== "rendering") return row;

  // ✅ allow multiple possible column names
  const renderId = String(
    row?.render_id ||
    row?.creatomate_render_id ||
    row?.creatomate_id ||
    row?.renderId ||
    ""
  ).trim();

  if (!renderId) return row;

  const rObj = await creatomateGetRender(renderId);
  const rStatus = normStatus(rObj?.status || "");
  const outUrl = extractCreatomateOutputUrl(rObj);

  if (outUrl && (rStatus === "completed" || rStatus === "succeeded" || rStatus === "completed")) {
    const { data: updated } = await sb
      .from("renders")
      .update({
        status: "succeeded",
        video_url: String(outUrl),
        error: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();

    return updated || row;
  }

  if (rStatus) {
    await sb.from("renders").update({ status: rStatus }).eq("id", row.id);
    return { ...row, status: rStatus };
  }

  return row;
}


// ✅ lazy poll captions (Creatomate caption render id stored in caption_render_id OR choices.caption_render_id)
async function lazyPollCaptionRender({ sb, row }) {
  const capUrl = String(row?.captioned_video_url || "");
  const capStatus = String(row?.caption_status || "").toLowerCase();
  const isCaptioning =
    capStatus === "captioning" || capStatus === "processing" || capStatus === "queued" || capStatus === "rendering";

  const captionRenderId =
    String(row?.caption_render_id || "") || String(row?.choices?.caption_render_id || "");

  if (!captionRenderId || capUrl || !isCaptioning) return row;

  const rObj = await creatomateGetRender(captionRenderId);
  const rStatus = normStatus(rObj?.status || "");
  const outUrl = extractCreatomateOutputUrl(rObj);

  if (outUrl && (rStatus === "completed" || rStatus === "succeeded")) {
    const { data: updated } = await sb
      .from("renders")
      .update({
        caption_status: "completed",
        captioned_video_url: String(outUrl),
        caption_error: null,
      })
      .eq("id", row.id)
      .select("*")
      .single();

    return updated || row;
  }

  if (rStatus) {
    await sb.from("renders").update({ caption_status: rStatus }).eq("id", row.id);
    return { ...row, caption_status: rStatus };
  }

  return row;
}

module.exports = async function handler(req, res) {
  try {
    // ✅ CORS FIRST ALWAYS
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();

    const sb = getAdminSupabase();

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

          // ✅ poll MAIN render first
          try {
            data = await lazyPollMainRender({ sb, row: data });
          } catch (e) {
            data.error = data.error || String(e?.message || e);
          }

          // ✅ poll Creatomate captions (if running)
          try {
            data = await lazyPollCaptionRender({ sb, row: data });
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

          // ✅ poll Submagic captions (back compat)
          try {
            const capStatus2 = String(data.caption_status || "").toLowerCase();
            const isCaptioning2 =
              capStatus2 === "captioning" || capStatus2 === "processing" || capStatus2 === "queued";

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

        // ✅ in list mode, only poll a small number of stuck items to avoid slow responses
        const items = Array.isArray(data) ? data : [];
        const stuck = items
  .filter((r) => {
    const rid = r?.render_id || r?.creatomate_render_id || r?.creatomate_id || r?.renderId;
    return !r.video_url && normStatus(r.status) === "rendering" && rid;
  })
  .slice(0, 10);

        for (const row of stuck) {
          try {
            const updated = await lazyPollMainRender({ sb, row });
            const idx = items.findIndex((x) => x.id === row.id);
            if (idx >= 0) items[idx] = updated;
          } catch {
            // ignore in list
          }
        }

        return res.status(200).json({ ok: true, items });
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
        // ACTION 2: captions-apply (Creatomate) ✅ FIXED (hide 2 layers)
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

          await sb
            .from("renders")
            .update({
              caption_status: "captioning",
              caption_error: null,
              caption_template_id: `creatomate:${template_id}`,
            })
            .eq("id", row.id);

          // ✅ SHOW ONLY ONE CAPTION LAYER
          const showSentence = style === "sentence";
          const showKaraoke = style === "karaoke";
          const showWord = style === "word";

          const mods = {
            // swap the video
            [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(row.video_url),

            // blank placeholder text so it doesn’t appear
            [`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`]: "",

            // hide the 2 unused subtitle layers
            [`${CREATO_SUB_SENTENCE}.opacity`]: showSentence ? 100 : 0,
            [`${CREATO_SUB_KARAOKE}.opacity`]: showKaraoke ? 100 : 0,
            [`${CREATO_SUB_WORD}.opacity`]: showWord ? 100 : 0,

            // If opacity doesn’t fully hide in your template, also force visible flags:
            [`${CREATO_SUB_SENTENCE}.visible`]: showSentence,
            [`${CREATO_SUB_KARAOKE}.visible`]: showKaraoke,
            [`${CREATO_SUB_WORD}.visible`]: showWord,
          };

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

          // Store caption render id
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
            const merged = { ...(row.choices || {}), caption_render_id: String(caption_render_id), caption_style: style };
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
