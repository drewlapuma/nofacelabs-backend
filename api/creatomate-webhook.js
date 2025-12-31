// api/creatomate-webhook.js

const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

// captions templates by aspect ratio (same env names you use in renders.js)
const CAPTIONS_TEMPLATE_916 = (process.env.CREATO_CAPTIONS_TEMPLATE_916 || "").trim();
const CAPTIONS_TEMPLATE_11 = (process.env.CREATO_CAPTIONS_TEMPLATE_11 || "").trim();
const CAPTIONS_TEMPLATE_169 = (process.env.CREATO_CAPTIONS_TEMPLATE_169 || "").trim();

const CREATO_VIDEO_ELEMENT_ID = (process.env.CREATO_VIDEO_ELEMENT_ID || "Video-DHM").trim();
const CREATO_CAPTIONS_JSON_ELEMENT_ID = (process.env.CREATO_CAPTIONS_JSON_ELEMENT_ID || "Subtitles-1").trim();

const API_BASE = (process.env.API_BASE || "").trim();

function pickCaptionsTemplateIdByAspect(aspectRatio) {
  const ar = String(aspectRatio || "9:16").trim();
  if (ar === "9:16") return CAPTIONS_TEMPLATE_916;
  if (ar === "1:1") return CAPTIONS_TEMPLATE_11;
  if (ar === "16:9") return CAPTIONS_TEMPLATE_169;
  return CAPTIONS_TEMPLATE_916 || CAPTIONS_TEMPLATE_11 || CAPTIONS_TEMPLATE_169 || "";
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x === "succeeded" || x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x === "failed" || x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

function extractOutputUrl(obj) {
  const fromOutputs =
    Array.isArray(obj?.outputs) && obj.outputs.length
      ? obj.outputs[0]?.url || obj.outputs[0]?.output
      : null;

  return obj?.output || obj?.url || obj?.video_url || obj?.download_url || fromOutputs || null;
}

async function creatomateGetRender(renderId) {
  if (!CREATOMATE_API_KEY) throw new Error("MISSING_CREATOMATE_API_KEY");

  const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`, {
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `CREATOMATE_GET_FAILED (${r.status})`);
  return j;
}

// Simple JSON POST (no https module needed because Node 18 fetch exists)
async function creatomateCreateRender(payload) {
  if (!CREATOMATE_API_KEY) throw new Error("MISSING_CREATOMATE_API_KEY");
  const r = await fetch("https://api.creatomate.com/v1/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CREATOMATE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

function captionLayerMods(styleSafe) {
  // Force exactly ONE captions layer visible and kill fallback to avoid doubles
  const mods = {
    "Subtitles_Sentence.visible": false,
    "Subtitles_Karaoke.visible": false,
    "Subtitles_Word.visible": false,
    "Subtitles-1.visible": false,
  };

  if (styleSafe === "karaoke") mods["Subtitles_Karaoke.visible"] = true;
  else if (styleSafe === "word") mods["Subtitles_Word.visible"] = true;
  else mods["Subtitles_Sentence.visible"] = true;

  return mods;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  const kind = String(req.query?.kind || "").trim().toLowerCase(); // "main" | "caption"
  if (!dbId) return res.status(200).json({ ok: true, skipped: "MISSING_DB_ID" });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    const bodyStatus = normStatus(body?.status || "");
    const bodyUrl = extractOutputUrl(body);

    console.log("[CREATOMATE_WEBHOOK] incoming", {
      dbId,
      kind,
      incomingRenderId,
      bodyStatus: body?.status,
      bodyStatusNorm: bodyStatus,
      hasBodyUrl: Boolean(bodyUrl),
      keys: Object.keys(body || {}),
    });

    // ✅ include fields needed for auto-caption
    const { data: row, error: readErr } = await sb
      .from("renders")
      .select("id, member_id, render_id, status, video_url, choices, caption_status, caption_style, captioned_video_url")
      .eq("id", dbId)
      .single();

    if (readErr || !row) {
      console.warn("[CREATOMATE_WEBHOOK] row not found yet, retry", { dbId, readErr });
      return res.status(404).json({ ok: false, error: "ROW_NOT_FOUND_RETRY" });
    }

    const mainId = String(row.render_id || "").trim();
    const renderIdToFetch = incomingRenderId || mainId || "";

    // ------------------------------------------------------------
    // ✅ MAIN
    // ------------------------------------------------------------
    if (kind === "main") {
      // immediate update if terminal + url
      if (bodyStatus === "succeeded" && bodyUrl) {
        const patch = {
          render_id: mainId || renderIdToFetch || null,
          status: "succeeded",
          video_url: String(bodyUrl),
          error: null,
        };

        const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
        if (updErr) {
          console.error("[CREATOMATE_WEBHOOK] main immediate update failed", updErr);
          return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
        }

        console.log("[CREATOMATE_WEBHOOK] main updated (body)", { dbId, status: patch.status, hasVideo: true });

        // ✅ AUTO-CAPTION: if queued and no captioned video yet
        const captionStatus = String(row.caption_status || "").toLowerCase();
        const hasCaptioned = Boolean(row.captioned_video_url);

        if (captionStatus === "queued" && !hasCaptioned) {
          const styleSafe = ["sentence", "karaoke", "word"].includes(String(row.caption_style || "").toLowerCase())
            ? String(row.caption_style).toLowerCase()
            : "sentence";

          const aspectRatio = row?.choices?.aspectRatio || row?.choices?.aspect_ratio || "9:16";
          const template_id = pickCaptionsTemplateIdByAspect(aspectRatio);

          if (template_id) {
            const publicBaseUrl = (API_BASE || `https://${req.headers.host}`).trim();
            const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(dbId)}&kind=caption`;

            const mods = {
              [`${CREATO_VIDEO_ELEMENT_ID}.source`]: String(bodyUrl),
              ...captionLayerMods(styleSafe),
            };

            // keep safe even if element doesn't exist
            mods[`${CREATO_CAPTIONS_JSON_ELEMENT_ID}.text`] = "";

            // set db to captioning BEFORE call
            await sb
              .from("renders")
              .update({
                caption_status: "captioning",
                caption_error: null,
                captioned_video_url: null,
              })
              .eq("id", dbId);

            const capResp = await creatomateCreateRender({
              template_id,
              modifications: mods,
              output_format: "mp4",
              webhook_url,
            });

            if (!capResp.ok) {
              console.error("[AUTO_CAPTIONS] creatomate failed", capResp.status, capResp.json);
              await sb
                .from("renders")
                .update({
                  caption_status: "failed",
                  caption_error: JSON.stringify(capResp.json || {}),
                })
                .eq("id", dbId);
            } else {
              console.log("[AUTO_CAPTIONS] started", { dbId, style: styleSafe });
            }
          } else {
            console.warn("[AUTO_CAPTIONS] missing captions template for aspect", { dbId, aspectRatio });
          }
        }

        return res.status(200).json({ ok: true });
      }

      // Otherwise: GET fallback
      let rObj = null;
      let getStatus = "";
      let getUrl = null;

      if (renderIdToFetch) {
        try {
          rObj = await creatomateGetRender(renderIdToFetch);
          getStatus = normStatus(rObj?.status || "");
          getUrl = extractOutputUrl(rObj);
        } catch (e) {
          console.warn("[CREATOMATE_WEBHOOK] main GET failed, fallback to body", { message: String(e?.message || e) });
        }
      }

      const finalStatus =
        bodyStatus === "succeeded" || bodyStatus === "failed" ? bodyStatus : getStatus || "rendering";
      const finalUrl = bodyUrl || getUrl || null;

      const patch = {
        render_id: mainId || renderIdToFetch || null,
        status: finalStatus,
      };

      if (finalStatus === "succeeded" && finalUrl) {
        patch.status = "succeeded";
        patch.video_url = String(finalUrl);
        patch.error = null;
      } else if (finalStatus === "failed") {
        patch.status = "failed";
        patch.error = JSON.stringify(rObj || body || {});
      }

      const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
      if (updErr) {
        console.error("[CREATOMATE_WEBHOOK] main update failed", updErr);
        return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
      }

      return res.status(200).json({ ok: true });
    }

    // ------------------------------------------------------------
    // ✅ CAPTION
    // ------------------------------------------------------------
    if (kind === "caption") {
      if (bodyStatus === "succeeded" && bodyUrl) {
        const patch = {
          caption_status: "completed",
          captioned_video_url: String(bodyUrl),
          caption_error: null,
        };

        const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
        if (updErr) {
          console.error("[CREATOMATE_WEBHOOK] caption immediate update failed", updErr);
          return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
        }

        console.log("[CREATOMATE_WEBHOOK] caption updated (body)", { dbId, hasCaptioned: true });
        return res.status(200).json({ ok: true });
      }

      // optional GET
      let rObj = null;
      let getStatus = "";
      let getUrl = null;

      if (renderIdToFetch) {
        try {
          rObj = await creatomateGetRender(renderIdToFetch);
          getStatus = normStatus(rObj?.status || "");
          getUrl = extractOutputUrl(rObj);
        } catch (e) {
          console.warn("[CREATOMATE_WEBHOOK] caption GET failed, fallback to body", { message: String(e?.message || e) });
        }
      }

      const finalStatus =
        bodyStatus === "succeeded" || bodyStatus === "failed" ? bodyStatus : getStatus || "captioning";
      const finalUrl = bodyUrl || getUrl || null;

      const patch = {
        caption_status: finalStatus === "succeeded" ? "completed" : finalStatus,
      };

      if (finalStatus === "succeeded" && finalUrl) {
        patch.caption_status = "completed";
        patch.captioned_video_url = String(finalUrl);
        patch.caption_error = null;
      } else if (finalStatus === "failed") {
        patch.caption_status = "failed";
        patch.caption_error = JSON.stringify(rObj || body || {});
      }

      const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
      if (updErr) {
        console.error("[CREATOMATE_WEBHOOK] caption update failed", updErr);
        return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
      }

      return res.status(200).json({ ok: true });
    }

    console.warn("[CREATOMATE_WEBHOOK] missing kind, retry", { dbId });
    return res.status(500).json({ ok: false, error: "MISSING_KIND_RETRY" });
  } catch (e) {
    console.error("[CREATOMATE_WEBHOOK] fatal", String(e?.message || e));
    return res.status(500).json({ ok: false, error: "WEBHOOK_ERROR_RETRY" });
  }
};
