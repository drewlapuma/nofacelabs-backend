// api/creatomate-webhook.js
// REQUIRED query params:
//   ?id=<renders.id>&kind=main
//   ?id=<renders.id>&kind=caption
//
// Updates:
// - MAIN: status + video_url (+ render_id if missing)
// - CAPTION: caption_status + captioned_video_url
//
// ✅ ADDITION:
// - After MAIN succeeds, auto-triggers captions via /api/auto-captions (server-only)
//   (keeps everything else the same)
//
// IMPORTANT: If the webhook body already says succeeded/failed AND contains a URL,
// we update immediately (do NOT call GET, do NOT downgrade status).

const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

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

// ✅ ADD: helper to kick off auto captions (non-blocking)
async function triggerAutoCaptions(req, dbId, row) {
  try {
    const alreadyCaptioned = Boolean(row?.captioned_video_url);
    const captioningNow = String(row?.caption_status || "").toLowerCase() === "captioning";
    const shouldStart = !alreadyCaptioned && !captioningNow;

    if (!shouldStart) return;

    const secret = String(process.env.INTERNAL_WEBHOOK_SECRET || "").trim();
    if (!secret) {
      console.warn("[CREATOMATE_WEBHOOK] INTERNAL_WEBHOOK_SECRET not set; skipping auto-captions");
      return;
    }

    const publicBaseUrl = String(process.env.API_BASE || `https://${req.headers.host}`).trim();
    const style = String(process.env.DEFAULT_CAPTION_STYLE || "sentence").trim().toLowerCase();

    // fire-and-forget
    fetch(`${publicBaseUrl}/api/auto-captions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-admin": secret,
      },
      body: JSON.stringify({ id: dbId, style }),
    }).catch(() => {});
  } catch (e) {
    console.warn("[CREATOMATE_WEBHOOK] triggerAutoCaptions failed", String(e?.message || e));
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  const kind = String(req.query?.kind || "").trim().toLowerCase(); // "main" | "caption"
  if (!dbId) return res.status(200).json({ ok: true, skipped: "MISSING_DB_ID" });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
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
      bodyUrlType: typeof body?.url,
      keys: Object.keys(body || {}),
    });

    // ✅ Only select columns that exist
    const { data: row, error: readErr } = await sb
      .from("renders")
      .select("id, member_id, render_id, status, video_url, caption_status, captioned_video_url")
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
      // ✅ If webhook says terminal + URL, TRUST IT and update immediately
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

        // ✅ ADD: auto-trigger captions now that main video exists
        await triggerAutoCaptions(req, dbId, row);

        return res.status(200).json({ ok: true });
      }

      // Otherwise: look up render to confirm (non-terminal webhook body or missing URL)
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

      // ✅ Prefer terminal signals (body beats GET; never downgrade)
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

      console.log("[CREATOMATE_WEBHOOK] main updated", {
        dbId,
        status: patch.status,
        hasVideo: Boolean(patch.video_url),
        finalStatus,
        hasFinalUrl: Boolean(finalUrl),
      });

      // ✅ ADD: auto-trigger captions if we just finished successfully
      if (patch.status === "succeeded" && patch.video_url) {
        await triggerAutoCaptions(req, dbId, row);
      }

      return res.status(200).json({ ok: true });
    }

    // ------------------------------------------------------------
    // ✅ CAPTION
    // ------------------------------------------------------------
    if (kind === "caption") {
      // ✅ If webhook says terminal + URL, TRUST IT
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

        console.log("[CREATOMATE_WEBHOOK] caption updated (body)", {
          dbId,
          status: patch.caption_status,
          hasCaptioned: true,
        });
        return res.status(200).json({ ok: true });
      }

      // Otherwise: GET (optional)
      let rObj = null;
      let getStatus = "";
      let getUrl = null;

      if (renderIdToFetch) {
        try {
          rObj = await creatomateGetRender(renderIdToFetch);
          getStatus = normStatus(rObj?.status || "");
          getUrl = extractOutputUrl(rObj);
        } catch (e) {
          console.warn("[CREATOMATE_WEBHOOK] caption GET failed, fallback to body", {
            message: String(e?.message || e),
          });
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

      console.log("[CREATOMATE_WEBHOOK] caption updated", {
        dbId,
        status: patch.caption_status,
        hasCaptioned: Boolean(patch.captioned_video_url),
        hasFinalUrl: Boolean(finalUrl),
      });

      return res.status(200).json({ ok: true });
    }

    // If kind missing, fail so Creatomate retries
    console.warn("[CREATOMATE_WEBHOOK] missing kind, retry", { dbId });
    return res.status(500).json({ ok: false, error: "MISSING_KIND_RETRY" });
  } catch (e) {
    console.error("[CREATOMATE_WEBHOOK] fatal", String(e?.message || e));
    return res.status(500).json({ ok: false, error: "WEBHOOK_ERROR_RETRY" });
  }
};
