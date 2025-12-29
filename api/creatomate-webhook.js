// api/creatomate-webhook.js
// Creatomate calls this after a render finishes.
// We use ?id=<renders.id> to know which DB row to update.

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
    (Array.isArray(renderObj?.outputs) ? (renderObj.outputs[0]?.url || renderObj.outputs[0]?.output) : null) ||
    null
  );
}

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "completed";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render")) return "captioning";
  return x;
}

module.exports = async function handler(req, res) {
  // Creatomate expects 200 quickly
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const dbId = String(req.query?.id || "").trim();
  if (!dbId) return res.status(400).json({ ok: false, error: "MISSING_DB_ID" });

  const sb = getAdminSupabase();

  try {
    // Creatomate webhook body usually includes render id
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const renderId = String(body?.id || body?.render_id || "").trim();

    // If webhook didn't include it, try to fetch row and read caption_render_id
    let finalRenderId = renderId;
    if (!finalRenderId) {
      const { data: row } = await sb.from("renders").select("caption_render_id, choices").eq("id", dbId).single();
      finalRenderId = String(row?.caption_render_id || row?.choices?.caption_render_id || "").trim();
    }

    if (!finalRenderId) {
      // still return 200 so they don't spam
      await sb.from("renders").update({ caption_status: "failed", caption_error: "WEBHOOK_NO_RENDER_ID" }).eq("id", dbId);
      return res.status(200).json({ ok: true });
    }

    const rObj = await creatomateGetRender(finalRenderId);
    const status = normStatus(rObj?.status || "");
    const outUrl = extractOutputUrl(rObj);

    if (status === "completed" && outUrl) {
      await sb.from("renders").update({
        caption_status: "completed",
        captioned_video_url: String(outUrl),
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
    await sb.from("renders").update({
      caption_status: "failed",
      caption_error: String(e?.message || e),
    }).eq("id", dbId);

    return res.status(200).json({ ok: true });
  }
};
