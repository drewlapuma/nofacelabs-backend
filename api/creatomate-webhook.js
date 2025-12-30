// api/creatomate-webhook.js
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

function normCreatomateStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const dbId = String(req.query?.id || "").trim();
  if (!dbId) return res.status(200).json({ ok: true });

  const sb = getAdminSupabase();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();
    if (!incomingRenderId) return res.status(200).json({ ok: true });

    const { data: row } = await sb
      .from("renders")
      .select("id, render_id, video_url, status, caption_render_id, captioned_video_url, caption_status, choices")
      .eq("id", dbId)
      .single();

    if (!row) return res.status(200).json({ ok: true });

    // Decide whether this webhook is MAIN or CAPTIONS
    const mainId = String(row.render_id || "").trim();
    const capId = String(row.caption_render_id || "").trim() || String(row?.choices?.caption_render_id || "").trim();

    const isMain = mainId && incomingRenderId === mainId;
    const isCaption = capId && incomingRenderId === capId;

    // If we don't have capId yet but captioning is active, treat as caption + link it
    const capStatus = String(row.caption_status || "").toLowerCase();
    const shouldTreatAsCaption = isCaption || (!isMain && capStatus === "captioning");

    // Fetch authoritative data from Creatomate
    const rObj = await creatomateGetRender(incomingRenderId);
    const status = normCreatomateStatus(rObj?.status || body?.status || "");
    const outUrl = extractOutputUrl(rObj) || String(body?.output || body?.url || "").trim() || null;

    // ---- MAIN ----
    if (isMain || (!shouldTreatAsCaption && !row.video_url)) {
      if (status === "succeeded" && outUrl) {
        await sb
          .from("renders")
          .update({ status: "succeeded", video_url: String(outUrl), error: null })
          .eq("id", dbId);
      } else if (status === "failed") {
        await sb
          .from("renders")
          .update({ status: "failed", error: JSON.stringify(rObj) })
          .eq("id", dbId);
      } else {
        await sb.from("renders").update({ status: status || "rendering" }).eq("id", dbId);
      }
      return res.status(200).json({ ok: true });
    }

    // ---- CAPTIONS ----
    if (shouldTreatAsCaption) {
      // ✅ Link caption render id if missing
      if (!capId) {
        const newChoices = { ...(row.choices || {}), caption_render_id: incomingRenderId };
        await sb
          .from("renders")
          .update({ caption_render_id: incomingRenderId, choices: newChoices })
          .eq("id", dbId);
      }

      if (status === "succeeded" && outUrl) {
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
        await sb.from("renders").update({ caption_status: status || "captioning" }).eq("id", dbId);
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Always 200 so Creatomate doesn't retry forever
    try {
      await sb
        .from("renders")
        .update({ caption_status: "failed", caption_error: String(e?.message || e) })
        .eq("id", dbId);
    } catch {}
    return res.status(200).json({ ok: true });
  }
};
