// api/render-status.js (CommonJS)
const { requireMemberId } = require("./_lib/auth");
const { getAdminSupabase } = require("./_lib/supabase");

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cache-Control, X-Requested-With, Accept"
  );
}

function normalizeStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "succeeded" || v === "completed" || v === "complete") return "complete";
  if (v === "failed" || v === "error") return "failed";
  return "rendering";
}

function extractVideoUrl(creato) {
  return (
    creato?.url ||
    creato?.result?.url ||
    (Array.isArray(creato?.output) ? creato.output?.[0]?.url : null) ||
    (Array.isArray(creato?.outputs) ? creato.outputs?.[0]?.url : null) ||
    null
  );
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  try {
    // ✅ Must be logged in
    const member_id = await requireMemberId(req);

    // ✅ Accept either:
    // - id=<db_id> (preferred)
    // - job_id=<creatomate_render_id> (fallback)
    const db_id = String(req.query?.id || "").trim();
    const job_id = String(req.query?.job_id || "").trim();

    if (!db_id && !job_id) return res.status(400).json({ error: "MISSING_ID_OR_JOB_ID" });

    if (!process.env.CREATOMATE_API_KEY) {
      return res.status(500).json({ error: "MISSING_CREATOMATE_API_KEY" });
    }

    const sb = getAdminSupabase();

    // ✅ Load the Supabase row AND enforce ownership
    let q = sb.from("renders").select("*").eq("member_id", member_id);
    q = db_id ? q.eq("id", db_id) : q.eq("render_id", job_id);

    const { data: row, error: rowErr } = await q.single();
    if (rowErr || !row) return res.status(404).json({ error: "NOT_FOUND" });

    const renderId = row.render_id;
    if (!renderId) {
      return res.status(200).json({
        ok: true,
        status: row.status || "rendering",
        video_url: row.video_url || null,
        render_id: null,
      });
    }

    // ✅ Call Creatomate
    const r = await fetch(
      `https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`,
      { headers: { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` } }
    );

    const creato = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("[RENDER_STATUS] Creatomate error", r.status, creato);
      return res.status(502).json({ error: "CREATOMATE_STATUS_FAILED", details: creato });
    }

    const status = normalizeStatus(creato.status);
    const videoUrl = extractVideoUrl(creato);

    // ✅ Update Supabase when finished/failed
    if (status === "complete" && videoUrl) {
      await sb
        .from("renders")
        .update({ status: "complete", video_url: videoUrl, error: null })
        .eq("id", row.id);
    } else if (status === "failed") {
      await sb
        .from("renders")
        .update({ status: "failed", error: JSON.stringify(creato) })
        .eq("id", row.id);
    } else {
      // keep row marked rendering
      if (String(row.status || "").toLowerCase() !== "rendering") {
        await sb.from("renders").update({ status: "rendering" }).eq("id", row.id);
      }
    }

    return res.status(200).json({
      ok: true,
      status,
      video_url: videoUrl || row.video_url || null,
      render_id: renderId,
    });
  } catch (e) {
    return res.status(401).json({ error: "UNAUTHORIZED", message: String(e?.message || e) });
  }
};
