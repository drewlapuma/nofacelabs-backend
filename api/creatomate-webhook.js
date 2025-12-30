// api/creatomate-webhook.js
// Requires: ?id=<renders.id>&kind=main  OR  ?id=<renders.id>&kind=caption
// Updates:
// - MAIN: status + video_url (+ render_id if missing)
// - CAPTION: caption_status + captioned_video_url
//
// IMPORTANT: Return non-200 when DB read/update fails so Creatomate retries.

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
  if (!dbId) return res.status(200).json({ ok: true, skipped: "MISSING_DB_ID" });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    console.log("[CREATOMATE_WEBHOOK] incoming", {
      dbId,
      kind,
      incomingRenderId,
      bodyStatus: body?.status,
      hasOutput: Boolean(body?.output || body?.url || body?.video_url),
      keys: Object.keys(body || {}),
    });

    // ✅ Only select columns that actually exist in your table
    const { data: row, error: readErr } = await sb
      .from("renders")
      .select("id, render_id, status, video_url, caption_status, captioned_video_url")
      .eq("id", dbId)
      .single();

    if (readErr || !row) {
      console.warn("[CREATOMATE_WEBHOOK] row not found yet, will retry", { dbId, readErr });
      return res.status(404).json({ ok: false, error: "ROW_NOT_FOUND_RETRY" });
    }

    const mainId = String(row.render_id || "").trim();

    // Decide which render ID to fetch
    let renderIdToFetch = incomingRenderId;
    if (!renderIdToFetch) renderIdToFetch = mainId;
    if (!renderIdToFetch) {
      console.warn("[CREATOMATE_WEBHOOK] missing render id, retry", { dbId, kind });
      return res.status(500).json({ ok: false, error: "MISSING_RENDER_ID_RETRY" });
    }

    // Get authoritative info (fallback to body if needed)
    let rObj = null;
    try {
      rObj = await creatomateGetRender(renderIdToFetch);
    } catch (e) {
      console.warn("[CREATOMATE_WEBHOOK] creatomateGetRender failed, using body", { message: String(e?.message || e) });
    }

    const status = normStatus((rObj?.status ?? body?.status) || "");
    const outUrl = extractOutputUrl(rObj) || extractOutputUrl(body) || null;

    // MAIN update
    if (kind === "main") {
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

    // CAPTION update (no caption_render_id column in your DB)
    if (kind === "caption") {
      const patch = {
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

    // If kind missing, fail so Creatomate retries (forces you to pass kind explicitly)
    console.warn("[CREATOMATE_WEBHOOK] missing kind, retry", { dbId });
    return res.status(500).json({ ok: false, error: "MISSING_KIND_RETRY" });
  } catch (e) {
    console.error("[CREATOMATE_WEBHOOK] fatal", String(e?.message || e));
    return res.status(500).json({ ok: false, error: "WEBHOOK_ERROR_RETRY" });
  }
};
