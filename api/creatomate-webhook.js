// api/creatomate-webhook.js
// Creatomate calls this after a render finishes.
//
// Recommended query params:
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

function extractOutputUrl(obj) {
  return (
    obj?.output ||
    obj?.url ||
    obj?.video_url ||
    (Array.isArray(obj?.outputs) ? (obj.outputs[0]?.url || obj.outputs[0]?.output) : null) ||
    null
  );
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("success") || x.includes("complete") || x === "done") return "succeeded";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

module.exports = async function handler(req, res) {
  // Creatomate expects 200 quickly
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const dbId = String(req.query?.id || "").trim();
  const kind = String(req.query?.kind || "").trim().toLowerCase(); // "main" | "caption"

  if (!dbId) return res.status(200).json({ ok: true });

  const sb = getAdminSupabase();

  // Parse body safely (Creatomate sends JSON)
  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    body = {};
  }

  const incomingRenderId = String(body?.id || body?.render_id || "").trim();

  // ✅ Use webhook payload FIRST (fast + reliable)
  // Creatomate webhook often includes { status, output }
  let status = normStatus(body?.status || "");
  let outUrl = extractOutputUrl(body);

  try {
    // Load row
    const { data: row, error: rowErr } = await sb
      .from("renders")
      .select("id, render_id, video_url, status, caption_render_id, captioned_video_url, caption_status")
      .eq("id", dbId)
      .single();

    if (rowErr || !row) return res.status(200).json({ ok: true });

    const mainId = String(row.render_id || "").trim();
    const capId = String(row.caption_render_id || "").trim();

    // Decide target (main vs caption)
    let treatAsMain = false;
    let treatAsCaption = false;

    if (kind === "main") treatAsMain = true;
    else if (kind === "caption") treatAsCaption = true;
    else {
      // If not specified, try match known ids, else smart fallback
      if (incomingRenderId && mainId && incomingRenderId === mainId) treatAsMain = true;
      else if (incomingRenderId && capId && incomingRenderId === capId) treatAsCaption = true;
      else if (!row.video_url) treatAsMain = true;
      else treatAsCaption = true;
    }

    // Pick a renderId to fetch only if needed
    const renderIdToFetch =
      incomingRenderId ||
      (treatAsCaption ? capId : mainId) ||
      mainId ||
      capId ||
      "";

    // ✅ Fallback: only call Creatomate GET if output/status are missing
    if ((!outUrl || !status) && renderIdToFetch && CREATOMATE_API_KEY) {
      const rObj = await creatomateGetRender(renderIdToFetch);
      status = status || normStatus(rObj?.status || "");
      outUrl = outUrl || extractOutputUrl(rObj);
    }

    // ---------------- MAIN update ----------------
    if (treatAsMain) {
      if ((status === "succeeded") && outUrl) {
        await sb.from("renders").update({
          status: "succeeded",
          video_url: String(outUrl),
          error: null,
          render_id: mainId || renderIdToFetch || null,
        }).eq("id", dbId);
      } else if (status === "failed") {
        await sb.from("renders").update({
          status: "failed",
          error: JSON.stringify(body),
          render_id: mainId || renderIdToFetch || null,
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          status: status || "rendering",
          render_id: mainId || renderIdToFetch || null,
        }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    // ---------------- CAPTION update ----------------
    if (treatAsCaption) {
      if ((status === "succeeded") && outUrl) {
        await sb.from("renders").update({
          caption_status: "completed",
          captioned_video_url: String(outUrl),
          caption_error: null,
          caption_render_id: capId || renderIdToFetch || null,
        }).eq("id", dbId);
      } else if (status === "failed") {
        await sb.from("renders").update({
          caption_status: "failed",
          caption_error: JSON.stringify(body),
          caption_render_id: capId || renderIdToFetch || null,
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          caption_status: status || "captioning",
          caption_render_id: capId || renderIdToFetch || null,
        }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Never fail webhook response.
    // ✅ Write error to the correct side if we can infer kind
    try {
      if (kind === "main") {
        await sb.from("renders").update({
          status: "failed",
          error: String(e?.message || e),
        }).eq("id", dbId);
      } else {
        await sb.from("renders").update({
          caption_status: "failed",
          caption_error: String(e?.message || e),
        }).eq("id", dbId);
      }
    } catch {}

    return res.status(200).json({ ok: true });
  }
};
