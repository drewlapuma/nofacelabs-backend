// api/creatomate-webhook.js
// Creatomate calls this after a render finishes.
// We use ?id=<renders.id> to know which DB row to update.
//
// IMPORTANT:
// - Updates MAIN render: status + video_url
// - Updates CAPTION render: caption_status + captioned_video_url
// - Always returns 200 to stop retries

const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

async function creatomateGetRender(renderId) {
  if (!CREATOMATE_API_KEY) throw new Error("MISSING_CREATOMATE_API_KEY");

  const r = await fetch(
    `https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`,
    { headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` } }
  );

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `CREATOMATE_GET_FAILED (${r.status})`);
  return j;
}

function extractOutputUrl(renderObj) {
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

function normCreatomateStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

module.exports = async function handler(req, res) {
  // Creatomate expects 200 quickly
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  if (!dbId) return res.status(200).json({ ok: true }); // don't trigger retries

  const sb = getAdminSupabase();

  try {
    // Webhook body generally includes { id: "<creatomate_render_id>", status: "...", output: "..." }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    // Load row so we know which render this is (main vs captions)
    const { data: row } = await sb
      .from("renders")
      .select("id, render_id, video_url, status, caption_render_id, captioned_video_url, caption_status")
      .eq("id", dbId)
      .single();

    if (!row) return res.status(200).json({ ok: true });

    // If body didn't include render id, fallback to main render_id
    const renderId = incomingRenderId || String(row.render_id || "").trim() || String(row.caption_render_id || "").trim();
    if (!renderId) {
      // Nothing to update, but still 200
      return res.status(200).json({ ok: true });
    }

    // Fetch authoritative status/output from Creatomate
    const rObj = await creatomateGetRender(renderId);
    const status = normCreatomateStatus(rObj?.status || body?.status || "");
    const outUrl = extractOutputUrl(rObj) || String(body?.output || body?.url || "").trim() || null;

    const isMain = String(row.render_id || "").trim() && renderId === String(row.render_id || "").trim();
    const isCaption = String(row.caption_render_id || "").trim() && renderId === String(row.caption_render_id || "").trim();

    // If we can't match, choose smart default:
    // - if video_url is still empty => treat as MAIN
    // - else if caption_status is captioning => treat as CAPTIONS
    const treatAsMain = isMain || (!isCaption && !row.video_url);
    const treatAsCaption = isCaption || (!treatAsMain && String(row.caption_status || "").toLowerCase() === "captioning");

    // ---------------- MAIN render update ----------------
    if (treatAsMain) {
      if ((status === "succeeded" || status === "completed") && outUrl) {
        await sb
          .from("renders")
          .update({
            status: "succeeded",
            video_url: String(outUrl),
            error: null,
          })
          .eq("id", dbId);
      } else if (status === "failed") {
        await sb
          .from("renders")
          .update({
            status: "failed",
            error: JSON.stringify(rObj),
          })
          .eq("id", dbId);
      } else {
        // keep status moving
        await sb
          .from("renders")
          .update({
            status: status || "rendering",
          })
          .eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // ---------------- CAPTION render update ----------------
    if (treatAsCaption) {
      if ((status === "succeeded" || status === "completed") && outUrl) {
        await sb
          .from("renders")
          .update({
            caption_status: "completed",
            captioned_video_url: String(outUrl),
            caption_error: null,
          })
          .eq("id", dbId);
      } else if (status === "failed") {
        await sb
          .from("renders")
          .update({
            caption_status: "failed",
            caption_error: JSON.stringify(rObj),
          })
          .eq("id", dbId);
      } else {
        await sb
          .from("renders")
          .update({
            caption_status: status || "captioning",
          })
          .eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // Fallback: do nothing but 200
    return res.status(200).json({ ok: true });
  } catch (e) {
    // Never fail webhook response
    try {
      await sb
        .from("renders")
        .update({
          caption_status: "failed",
          caption_error: String(e?.message || e),
        })
        .eq("id", dbId);
    } catch {}

    return res.status(200).json({ ok: true });
  }
};
