// api/creatomate-webhook.js
// Creatomate calls this after a render finishes.
//
// IMPORTANT:
// - MAIN renders should call:    /api/creatomate-webhook?id=<renders.id>&kind=main
// - CAPTION renders should call: /api/creatomate-webhook?id=<renders.id>&kind=caption
//
// This handler:
// - Updates MAIN render: status + video_url + error
// - Updates CAPTION render: caption_status + captioned_video_url + caption_error
// - Always returns 200 to stop retries

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
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait"))
    return "rendering";
  return x;
}

function safeJsonStringify(obj, fallback = "") {
  try {
    return JSON.stringify(obj);
  } catch {
    return fallback || String(obj || "");
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  if (!dbId) return res.status(200).json({ ok: true });

  const kind = String(req.query?.kind || "").trim().toLowerCase(); // "main" | "caption" | ""

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    const { data: row } = await sb
      .from("renders")
      .select("id, render_id, video_url, status, error, caption_render_id, captioned_video_url, caption_status, caption_error, choices")
      .eq("id", dbId)
      .single();

    if (!row) return res.status(200).json({ ok: true });

    const mainId = String(row?.render_id || "").trim();
    const capId =
      String(row?.caption_render_id || "").trim() || String(row?.choices?.caption_render_id || "").trim();

    const renderId =
      incomingRenderId ||
      (kind === "caption" ? capId : "") ||
      (kind === "main" ? mainId : "") ||
      mainId ||
      capId;

    if (!renderId) return res.status(200).json({ ok: true });

    const rObj = await creatomateGetRender(renderId);
    const status = normCreatomateStatus(rObj?.status || body?.status || "");
    const outUrl =
      extractOutputUrl(rObj) || String(body?.output || body?.url || body?.video_url || "").trim() || null;

    const matchesMain = !!(mainId && renderId === mainId);
    const matchesCaption = !!(capId && renderId === capId);

    let target = "unknown";
    if (kind === "main" || kind === "caption") target = kind;
    else if (matchesMain) target = "main";
    else if (matchesCaption) target = "caption";
    else if (!row.video_url) target = "main";
    else target = "caption";

    if (target === "main") {
      if ((status === "succeeded" || status === "completed") && outUrl) {
        await sb.from("renders").update({ status: "succeeded", video_url: String(outUrl), error: null }).eq("id", dbId);
      } else if (status === "failed") {
        await sb.from("renders").update({ status: "failed", error: safeJsonStringify(rObj, "CREATOMATE_MAIN_FAILED") }).eq("id", dbId);
      } else {
        await sb.from("renders").update({ status: status || "rendering" }).eq("id", dbId);
      }
      return res.status(200).json({ ok: true });
    }

    if (target === "caption") {
      if ((status === "succeeded" || status === "completed") && outUrl) {
        await sb
          .from("renders")
          .update({ caption_status: "completed", captioned_video_url: String(outUrl), caption_error: null })
          .eq("id", dbId);
      } else if (status === "failed") {
        await sb
          .from("renders")
          .update({ caption_status: "failed", caption_error: safeJsonStringify(rObj, "CREATOMATE_CAPTION_FAILED") })
          .eq("id", dbId);
      } else {
        await sb.from("renders").update({ caption_status: status || "captioning" }).eq("id", dbId);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    try {
      await sb
        .from("renders")
        .update({ caption_status: "failed", caption_error: String(e?.message || e) })
        .eq("id", dbId);
    } catch {}
    return res.status(200).json({ ok: true });
  }
};
