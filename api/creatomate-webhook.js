// api/creatomate-webhook.js
// Creatomate calls this after a render finishes.
//
// REQUIRED query params (recommended):
//   ?id=<renders.id>&kind=main
//   ?id=<renders.id>&kind=caption
//
// Updates:
// - MAIN: status + video_url (+ render_id if missing)
// - CAPTION: caption_status + captioned_video_url (+ caption_render_id if missing)
//
// Always returns 200 so Creatomate doesn’t retry.

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
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const dbId = String(req.query?.id || "").trim();
  const kind = String(req.query?.kind || "").trim().toLowerCase(); // "main" | "caption"

  // If we don't know the row, return 200 to stop retries
  if (!dbId) return res.status(200).json({ ok: true });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    // Load row
    const { data: row } = await sb
      .from("renders")
      .select("id, render_id, video_url, status, caption_render_id, captioned_video_url, caption_status")
      .eq("id", dbId)
      .single();

    if (!row) return res.status(200).json({ ok: true });

    // Choose render id to fetch
    const mainId = String(row.render_id || "").trim();
    const capId = String(row.caption_render_id || "").trim();

    let renderIdToFetch = incomingRenderId;

    // If kind explicitly provided, trust it
    if (!renderIdToFetch) {
      if (kind === "caption") renderIdToFetch = capId;
      else renderIdToFetch = mainId;
    }

    // If still missing, fallback to anything we have
    if (!renderIdToFetch) renderIdToFetch = mainId || capId;

    if (!renderIdToFetch) return res.status(200).json({ ok: true });

    // Fetch authoritative render data
    const rObj = await creatomateGetRender(renderIdToFetch);
    const status = normCreatomateStatus(rObj?.status || body?.status || "");
    const outUrl = extractOutputUrl(rObj) || String(body?.output || body?.url || "").trim() || null;

    // Decide whether to treat as main/caption
    const matchesMain = mainId && renderIdToFetch === mainId;
    const matchesCap = capId && renderIdToFetch === capId;

    let treatAsMain = false;
    let treatAsCaption = false;

    if (kind === "main") treatAsMain = true;
    else if (kind === "caption") treatAsCaption = true;
    else if (matchesMain) treatAsMain = true;
    else if (matchesCap) treatAsCaption = true;
    else {
      // Smart fallback:
      // if main video_url is empty, assume this webhook is for MAIN
      if (!row.video_url) treatAsMain = true;
      else treatAsCaption = true;
    }

    // ---------------- MAIN update ----------------
    if (treatAsMain) {
      if (status === "succeeded" && outUrl) {
        await sb.from("renders").update({
          status: "succeeded",
          video_url: String(outUrl),
          error: null,
          // If render_id wasn't saved (rare), persist it
          render_id: mainId || renderIdToFetch,
        }).eq("id", dbId);
      } else if (status === "failed") {
        await sb.from("renders").update({
          status: "failed",
          error: JSON.stringify(rObj),
          render_id: mainId || renderIdToFetch,
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          status: status || "rendering",
          render_id: mainId || renderIdToFetch,
        }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // ---------------- CAPTION update ----------------
    if (treatAsCaption) {
      if (status === "succeeded" && outUrl) {
        await sb.from("renders").update({
          caption_status: "completed",
          captioned_video_url: String(outUrl),
          caption_error: null,
          caption_render_id: capId || renderIdToFetch,
        }).eq("id", dbId);
      } else if (status === "failed") {
        await sb.from("renders").update({
          caption_status: "failed",
          caption_error: JSON.stringify(rObj),
          caption_render_id: capId || renderIdToFetch,
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          caption_status: status || "captioning",
          caption_render_id: capId || renderIdToFetch,
        }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Never fail webhook response
    try {
      await sb.from("renders").update({
        caption_status: "failed",
        caption_error: String(e?.message || e),
      }).eq("id", dbId);
    } catch {}

    return res.status(200).json({ ok: true });
  }
};
