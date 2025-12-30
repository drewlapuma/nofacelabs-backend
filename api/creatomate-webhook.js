// api/creatomate-webhook.js
// Updates MAIN render (status/video_url) and CAPTION render (caption_status/captioned_video_url).
// Self-heals if caption_render_id wasn't saved yet when webhook arrives.
// Always returns 200 to stop retries.

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

function extractOutputUrl(renderObj, body) {
  return (
    String(
      renderObj?.output ||
        renderObj?.url ||
        renderObj?.video_url ||
        (Array.isArray(renderObj?.outputs) ? (renderObj.outputs[0]?.url || renderObj.outputs[0]?.output) : "") ||
        body?.output ||
        body?.url ||
        body?.video_url ||
        ""
    ).trim() || null
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
  // Creatomate expects 200 quickly
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const dbId = String(req.query?.id || "").trim();
  if (!dbId) return res.status(200).json({ ok: true });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    // Load row (we decide whether this webhook is for main or captions)
    const { data: row } = await sb
      .from("renders")
      .select("id, render_id, video_url, status, caption_render_id, captioned_video_url, caption_status")
      .eq("id", dbId)
      .single();

    if (!row) return res.status(200).json({ ok: true });

    const mainId = String(row.render_id || "").trim();
    const capId = String(row.caption_render_id || "").trim();

    // Decide target:
    // 1) If incoming matches one, use it.
    // 2) If captions are "captioning" and main already has video_url, treat as CAPTIONS.
    // 3) Else treat as MAIN.
    const captionsInProgress = ["captioning", "rendering", "processing", "queued"].includes(
      String(row.caption_status || "").toLowerCase()
    );
    const mainReady = !!String(row.video_url || "").trim();

    let target = "main";
    if (incomingRenderId && capId && incomingRenderId === capId) target = "caption";
    else if (incomingRenderId && mainId && incomingRenderId === mainId) target = "main";
    else if (mainReady && captionsInProgress) target = "caption";

    // If webhook came BEFORE we saved caption_render_id, self-heal by saving it
    if (target === "caption" && incomingRenderId && !capId) {
      await sb.from("renders").update({ caption_render_id: incomingRenderId }).eq("id", dbId);
    }

    // Fetch authoritative render object.
    // If we don't have an id in webhook (rare), fallback to stored id for the chosen target.
    const idToFetch =
      incomingRenderId ||
      (target === "caption" ? (capId || "") : (mainId || ""));

    if (!idToFetch) return res.status(200).json({ ok: true });

    const rObj = await creatomateGetRender(idToFetch);
    const status = normStatus(rObj?.status || body?.status || "");
    const outUrl = extractOutputUrl(rObj, body);

    if (target === "main") {
      if ((status === "succeeded" || status === "completed") && outUrl) {
        await sb.from("renders").update({
          status: "succeeded",
          video_url: outUrl,
          error: null,
        }).eq("id", dbId);
      } else if (status === "failed") {
        await sb.from("renders").update({
          status: "failed",
          error: JSON.stringify(rObj),
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({ status: status || "rendering" }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // captions
    if ((status === "succeeded" || status === "completed") && outUrl) {
      await sb.from("renders").update({
        caption_status: "completed",
        captioned_video_url: outUrl,
        caption_error: null,
      }).eq("id", dbId);
    } else if (status === "failed") {
      await sb.from("renders").update({
        caption_status: "failed",
        caption_error: JSON.stringify(rObj),
      }).eq("id", dbId);
    } else {
      await sb.from("renders").update({ caption_status: status || "captioning" }).eq("id", dbId);
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
