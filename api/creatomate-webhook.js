// api/creatomate-webhook.js
// Creatomate calls this after a render finishes.
//
// Query params:
//   ?id=<renders.id>&kind=main
//   ?id=<renders.id>&kind=caption
//
// IMPORTANT CHANGE:
// - We DO NOT always return 200 anymore.
// - If we cannot find/update the DB row, we return 404/500 so Creatomate retries.

const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

async function creatomateGetRender(renderId) {
  if (!CREATOMATE_API_KEY) throw new Error("MISSING_CREATOMATE_API_KEY");

  const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`, {
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `CREATOMATE_GET_FAILED (${r.status})`);
  return j;
}

function extractOutputUrl(obj) {
  // Creatomate commonly uses "output" but we try several shapes.
  const fromOutputs =
    Array.isArray(obj?.outputs) && obj.outputs.length
      ? obj.outputs[0]?.url || obj.outputs[0]?.output
      : null;

  return (
    obj?.output ||
    obj?.url ||
    obj?.video_url ||
    obj?.download_url ||
    fromOutputs ||
    null
  );
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  const kind = String(req.query?.kind || "").trim().toLowerCase(); // "main" | "caption"

  // No id = nothing to do. Returning 200 is fine.
  if (!dbId) return res.status(200).json({ ok: true, skipped: "MISSING_DB_ID" });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    // LOG what we got so you can see it in Vercel logs
    console.log("[CREATOMATE_WEBHOOK] incoming", {
      dbId,
      kind,
      incomingRenderId,
      bodyStatus: body?.status,
      hasOutput: Boolean(body?.output || body?.url || body?.video_url),
      keys: Object.keys(body || {}),
    });

    // Load DB row
    const { data: row, error: readErr } = await sb
      .from("renders")
      .select("id, render_id, status, video_url, caption_render_id, caption_status, captioned_video_url")
      .eq("id", dbId)
      .single();

    // ✅ IMPORTANT: if row isn't there, RETURN NON-200 so Creatomate retries
    if (readErr || !row) {
      console.warn("[CREATOMATE_WEBHOOK] row not found yet, will retry", { dbId, readErr });
      return res.status(404).json({ ok: false, error: "ROW_NOT_FOUND_RETRY" });
    }

    const mainId = String(row.render_id || "").trim();
    const capId = String(row.caption_render_id || "").trim();

    // Choose which render id to inspect
    let renderIdToFetch = incomingRenderId;

    if (!renderIdToFetch) {
      if (kind === "caption") renderIdToFetch = capId;
      else renderIdToFetch = mainId;
    }
    if (!renderIdToFetch) renderIdToFetch = mainId || capId;

    if (!renderIdToFetch) {
      console.warn("[CREATOMATE_WEBHOOK] no render id to fetch", { dbId, kind, mainId, capId });
      // Return 500 so it retries later (we need a render id)
      return res.status(500).json({ ok: false, error: "MISSING_RENDER_ID_RETRY" });
    }

    // Prefer Creatomate API for authoritative output/status,
    // but if that fails, fallback to the webhook body.
    let rObj = null;
    try {
      rObj = await creatomateGetRender(renderIdToFetch);
    } catch (e) {
      console.warn("[CREATOMATE_WEBHOOK] creatomateGetRender failed, using body fallback", {
        message: String(e?.message || e),
      });
    }

    const status = normStatus((rObj?.status ?? body?.status) || "");
    const outUrl =
      extractOutputUrl(rObj) ||
      extractOutputUrl(body) ||
      String(body?.output || body?.url || body?.video_url || "").trim() ||
      null;

    const matchesMain = mainId && renderIdToFetch === mainId;
    const matchesCap = capId && renderIdToFetch === capId;

    const treatAsMain =
      kind === "main" || matchesMain || (!kind && !matchesCap && !row.video_url);

    const treatAsCaption =
      kind === "caption" || matchesCap || (!treatAsMain && String(row.caption_status || "").toLowerCase() === "captioning");

    // MAIN update
    if (treatAsMain) {
      const patch = {
        render_id: mainId || renderIdToFetch,
        status: status || row.status || "rendering",
      };

      if (status === "succeeded" && outUrl) {
        patch.status = "succeeded";
        patch.video_url = String(outUrl);
        patch.error = null;
      } else if (status === "failed") {
        patch.status = "failed";
        patch.error = JSON.stringify(rObj || body || {});
      }

      const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
      if (updErr) {
        console.error("[CREATOMATE_WEBHOOK] main update failed", updErr);
        return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
      }

      console.log("[CREATOMATE_WEBHOOK] main updated", { dbId, status: patch.status, hasVideo: !!patch.video_url });
      return res.status(200).json({ ok: true });
    }

    // CAPTION update
    if (treatAsCaption) {
      const patch = {
        caption_render_id: capId || renderIdToFetch,
        caption_status: status || row.caption_status || "captioning",
      };

      if (status === "succeeded" && outUrl) {
        patch.caption_status = "completed";
        patch.captioned_video_url = String(outUrl);
        patch.caption_error = null;
      } else if (status === "failed") {
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
        hasCaptioned: !!patch.captioned_video_url,
      });

      return res.status(200).json({ ok: true });
    }

    // If we couldn't decide, return 200 but log it.
    console.log("[CREATOMATE_WEBHOOK] no-op (could not classify)", { dbId, kind, renderIdToFetch });
    return res.status(200).json({ ok: true, noop: true });
  } catch (e) {
    console.error("[CREATOMATE_WEBHOOK] fatal error", String(e?.message || e));
    // Return 500 so Creatomate retries (better than losing the update)
    return res.status(500).json({ ok: false, error: "WEBHOOK_ERROR_RETRY" });
  }
};
