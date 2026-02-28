// api/creatomate-webhook.js
// REQUIRED query params:
//   ?id=<renders.id>&kind=main
//   ?id=<renders.id>&kind=caption
//   ?id=<renders.id>&kind=composite
//
// Also accepted aliases:
//   kind=reddit        -> main
//   kind=roblox_rants  -> main
//
// Updates:
// - MAIN: status + video_url (+ render_id if missing)
// - CAPTION: caption_status + captioned_video_url
// - COMPOSITE: composite_status + composite_video_url (+ composite_job_id optional)
//
// IMPORTANT: If the webhook body already says succeeded/failed AND contains a URL,
// we update immediately (do NOT call GET, do NOT downgrade status).

const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();

function normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (!x) return "";
  if (x === "succeeded" || x.includes("succeed") || x.includes("complete") || x === "done") return "succeeded";
  if (x === "failed" || x.includes("fail") || x.includes("error")) return "failed";
  if (x.includes("queue") || x.includes("process") || x.includes("render") || x.includes("wait")) return "rendering";
  return x;
}

function extractOutputUrl(obj) {
  const fromOutputs =
    Array.isArray(obj?.outputs) && obj.outputs.length
      ? obj.outputs[0]?.url || obj.outputs[0]?.output
      : null;

  return obj?.output || obj?.url || obj?.video_url || obj?.download_url || fromOutputs || null;
}

async function creatomateGetRender(renderId) {
  if (!CREATOMATE_API_KEY) throw new Error("MISSING_CREATOMATE_API_KEY");

  const r = await fetch(`https://api.creatomate.com/v1/renders/${encodeURIComponent(renderId)}`, {
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error || `CREATOMATE_GET_FAILED (${r.status})`);
  return j;
}

// ✅ Robust query getter (works even when req.query is empty on Vercel)
function getQuery(req, key) {
  if (req?.query && req.query[key] != null) return String(req.query[key]);
  try {
    const u = new URL(req.url, "http://localhost");
    const v = u.searchParams.get(key);
    return v == null ? "" : String(v);
  } catch {
    return "";
  }
}

// ✅ Robust body parser (Creatomate may send JSON or string)
function parseBody(req) {
  try {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (req.body && typeof req.body === "object") return req.body;
    return {};
  } catch {
    return {};
  }
}

module.exports = async function handler(req, res) {
  // ✅ Loud early log to prove route is being hit
  try {
    console.log("[CREATOMATE_WEBHOOK] hit", {
      method: req.method,
      url: req.url,
      hasQueryObj: Boolean(req.query),
      host: req.headers?.host,
      ua: req.headers?.["user-agent"],
    });
  } catch {}

  if (req.method === "OPTIONS") return res.status(200).end();

  // ✅ Allow GET temporarily so you can test in browser and see logs
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const dbId = getQuery(req, "id").trim();
  let kind = getQuery(req, "kind").trim().toLowerCase(); // main | caption | composite | aliases
  if (kind === "reddit" || kind === "roblox_rants") kind = "main";

  // ✅ If missing dbId, return 500 so Creatomate retries (and so you notice)
  if (!dbId) {
    console.warn("[CREATOMATE_WEBHOOK] missing dbId", { url: req.url, query: req.query || null });
    return res.status(500).json({ ok: false, error: "MISSING_DB_ID_RETRY" });
  }

  // ✅ GET: just log + confirm the endpoint is reachable
  if (req.method === "GET") {
    console.log("[CREATOMATE_WEBHOOK] GET ping", { dbId, kind });
    return res.status(200).json({ ok: true, ping: true, dbId, kind });
  }

  const sb = getAdminSupabase();

  try {
    const body = parseBody(req);
    const incomingRenderId = String(body?.id || body?.render_id || "").trim();

    const bodyStatus = normStatus(body?.status || "");
    const bodyUrl = extractOutputUrl(body);

    console.log("[CREATOMATE_WEBHOOK] incoming", {
      dbId,
      kind,
      incomingRenderId,
      bodyStatusRaw: body?.status,
      bodyStatusNorm: bodyStatus,
      hasBodyUrl: Boolean(bodyUrl),
      keys: Object.keys(body || {}),
    });

    const { data: row, error: readErr } = await sb
      .from("renders")
      .select(
        [
          "id",
          "member_id",
          "render_id",
          "status",
          "video_url",
          "error",
          "caption_status",
          "captioned_video_url",
          "caption_error",
          "caption_template_id",
          "composite_status",
          "composite_video_url",
          "composite_error",
          "composite_job_id",
        ].join(",")
      )
      .eq("id", dbId)
      .single();

    if (readErr || !row) {
      console.warn("[CREATOMATE_WEBHOOK] row not found yet, retry", { dbId, readErr });
      return res.status(500).json({ ok: false, error: "ROW_NOT_FOUND_RETRY" });
    }

    const mainId = String(row.render_id || "").trim();
    const compositeId = String(row.composite_job_id || "").trim();

    const renderIdToFetch =
      incomingRenderId ||
      (kind === "composite" ? compositeId : mainId) ||
      "";

    // ------------------------------------------------------------
    // ✅ MAIN
    // ------------------------------------------------------------
    if (kind === "main") {
      // Trust terminal+url from webhook
      if (bodyStatus === "succeeded" && bodyUrl) {
        const patch = {
          render_id: mainId || renderIdToFetch || null,
          status: "succeeded",
          video_url: String(bodyUrl),
          error: null,
        };

        const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
        if (updErr) {
          console.error("[CREATOMATE_WEBHOOK] main immediate update failed", updErr);
          return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
        }

        console.log("[CREATOMATE_WEBHOOK] main updated (body)", { dbId, status: patch.status, hasVideo: true });
        return res.status(200).json({ ok: true });
      }

      // Otherwise: GET to confirm
      let rObj = null;
      let getStatus = "";
      let getUrl = null;

      if (renderIdToFetch) {
        try {
          rObj = await creatomateGetRender(renderIdToFetch);
          getStatus = normStatus(rObj?.status || "");
          getUrl = extractOutputUrl(rObj);
        } catch (e) {
          console.warn("[CREATOMATE_WEBHOOK] main GET failed, fallback to body", {
            message: String(e?.message || e),
            renderIdToFetch,
          });
        }
      }

      const finalStatus =
        bodyStatus === "succeeded" || bodyStatus === "failed"
          ? bodyStatus
          : getStatus || "rendering";

      const finalUrl = bodyUrl || getUrl || null;

      const patch = {
        render_id: mainId || renderIdToFetch || null,
        status: finalStatus,
      };

      if (finalStatus === "succeeded" && finalUrl) {
        patch.status = "succeeded";
        patch.video_url = String(finalUrl);
        patch.error = null;
      } else if (finalStatus === "failed") {
        patch.status = "failed";
        patch.error = JSON.stringify(rObj || body || {});
      }

      const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
      if (updErr) {
        console.error("[CREATOMATE_WEBHOOK] main update failed", updErr);
        return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
      }

      console.log("[CREATOMATE_WEBHOOK] main updated", {
        dbId,
        status: patch.status,
        hasVideo: Boolean(patch.video_url),
      });

      return res.status(200).json({ ok: true });
    }

    // ------------------------------------------------------------
    // ✅ CAPTION
    // ------------------------------------------------------------
    if (kind === "caption") {
      if (bodyStatus === "succeeded" && bodyUrl) {
        const patch = {
          caption_status: "completed",
          captioned_video_url: String(bodyUrl),
          caption_error: null,
        };

        const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
        if (updErr) {
          console.error("[CREATOMATE_WEBHOOK] caption immediate update failed", updErr);
          return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
        }

        console.log("[CREATOMATE_WEBHOOK] caption updated (body)", { dbId, status: patch.caption_status });
        return res.status(200).json({ ok: true });
      }

      let rObj = null;
      let getStatus = "";
      let getUrl = null;

      if (renderIdToFetch) {
        try {
          rObj = await creatomateGetRender(renderIdToFetch);
          getStatus = normStatus(rObj?.status || "");
          getUrl = extractOutputUrl(rObj);
        } catch (e) {
          console.warn("[CREATOMATE_WEBHOOK] caption GET failed, fallback to body", {
            message: String(e?.message || e),
            renderIdToFetch,
          });
        }
      }

      const finalStatus =
        bodyStatus === "succeeded" || bodyStatus === "failed"
          ? bodyStatus
          : getStatus || "captioning";

      const finalUrl = bodyUrl || getUrl || null;

      const patch = {
        caption_status: finalStatus === "succeeded" ? "completed" : finalStatus,
      };

      if (finalStatus === "succeeded" && finalUrl) {
        patch.caption_status = "completed";
        patch.captioned_video_url = String(finalUrl);
        patch.caption_error = null;
      } else if (finalStatus === "failed") {
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
        hasCaptioned: Boolean(patch.captioned_video_url),
      });

      return res.status(200).json({ ok: true });
    }

    // ------------------------------------------------------------
    // ✅ COMPOSITE
    // ------------------------------------------------------------
    if (kind === "composite") {
      if (bodyStatus === "succeeded" && bodyUrl) {
        const patch = {
          composite_status: "completed",
          composite_video_url: String(bodyUrl),
          composite_error: null,
          composite_job_id: compositeId || incomingRenderId || null,
        };

        const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
        if (updErr) {
          console.error("[CREATOMATE_WEBHOOK] composite immediate update failed", updErr);
          return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
        }

        console.log("[CREATOMATE_WEBHOOK] composite updated (body)", { dbId, status: patch.composite_status });
        return res.status(200).json({ ok: true });
      }

      let rObj = null;
      let getStatus = "";
      let getUrl = null;

      if (renderIdToFetch) {
        try {
          rObj = await creatomateGetRender(renderIdToFetch);
          getStatus = normStatus(rObj?.status || "");
          getUrl = extractOutputUrl(rObj);
        } catch (e) {
          console.warn("[CREATOMATE_WEBHOOK] composite GET failed, fallback to body", {
            message: String(e?.message || e),
            renderIdToFetch,
          });
        }
      }

      const finalStatus =
        bodyStatus === "succeeded" || bodyStatus === "failed"
          ? bodyStatus
          : getStatus || "rendering";

      const finalUrl = bodyUrl || getUrl || null;

      const patch = {
        composite_job_id: compositeId || incomingRenderId || null,
        composite_status: finalStatus === "succeeded" ? "completed" : finalStatus,
      };

      if (finalStatus === "succeeded" && finalUrl) {
        patch.composite_status = "completed";
        patch.composite_video_url = String(finalUrl);
        patch.composite_error = null;
      } else if (finalStatus === "failed") {
        patch.composite_status = "failed";
        patch.composite_error = JSON.stringify(rObj || body || {});
      }

      const { error: updErr } = await sb.from("renders").update(patch).eq("id", dbId);
      if (updErr) {
        console.error("[CREATOMATE_WEBHOOK] composite update failed", updErr);
        return res.status(500).json({ ok: false, error: "DB_UPDATE_FAILED_RETRY" });
      }

      console.log("[CREATOMATE_WEBHOOK] composite updated", {
        dbId,
        status: patch.composite_status,
        hasComposite: Boolean(patch.composite_video_url),
      });

      return res.status(200).json({ ok: true });
    }

    console.warn("[CREATOMATE_WEBHOOK] missing/unknown kind, retry", { dbId, kind });
    return res.status(500).json({ ok: false, error: "MISSING_KIND_RETRY" });
  } catch (e) {
    console.error("[CREATOMATE_WEBHOOK] fatal", String(e?.message || e));
    return res.status(500).json({ ok: false, error: "WEBHOOK_ERROR_RETRY" });
  }
};
