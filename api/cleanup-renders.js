// api/cleanup-renders.js (CommonJS, Node 18)

const { createClient } = require("@supabase/supabase-js");

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Bucket where you upload voiceovers (matches your create-video.js)
const VOICE_BUCKET = process.env.VOICE_BUCKET || "voiceovers";

// TTL days (default 14)
const RENDER_TTL_DAYS = Number(process.env.RENDER_TTL_DAYS || 14);

// Optional cron auth secret (highly recommended)
const CRON_SECRET = process.env.CRON_SECRET || "";

// Safety limits
const BATCH_SIZE = Math.min(500, Math.max(50, Number(process.env.CLEANUP_BATCH_SIZE || 200)));
const MAX_LOOPS = Math.min(50, Math.max(1, Number(process.env.CLEANUP_MAX_LOOPS || 10)));

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(obj));
}

function isAuthorized(req) {
  // allow either header or query param
  const h = req.headers["x-cron-secret"] || req.headers["x-cron-key"] || "";
  const q = (() => {
    try {
      const u = new URL(req.url, "http://localhost");
      return u.searchParams.get("secret") || "";
    } catch {
      return "";
    }
  })();

  // If no secret configured, allow (not recommended)
  if (!CRON_SECRET) return true;

  return String(h) === String(CRON_SECRET) || String(q) === String(CRON_SECRET);
}

function cutoffIso(days) {
  const ms = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

async function removeVoiceFiles(ids) {
  if (!ids.length) return { removed: 0 };

  // best-effort: remove voice.mp3 for each render id
  const paths = ids.map((id) => `${id}/voice.mp3`);

  const { data, error } = await supabase.storage.from(VOICE_BUCKET).remove(paths);

  // Note: storage.remove may return partial success; we treat errors as non-fatal
  if (error) {
    console.error("[CLEANUP_STORAGE_REMOVE_ERROR]", error);
    return { removed: 0, error: String(error.message || error) };
  }

  return { removed: Array.isArray(data) ? data.length : 0 };
}

async function deleteRenderRows(ids) {
  if (!ids.length) return { deleted: 0 };

  const { error } = await supabase.from("renders").delete().in("id", ids);
  if (error) {
    console.error("[CLEANUP_DB_DELETE_ERROR]", error);
    return { deleted: 0, error: String(error.message || error) };
  }

  return { deleted: ids.length };
}

async function fetchOldRenderIds(cutoff, limit) {
  const { data, error } = await supabase
    .from("renders")
    .select("id, created_at")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const ids = (data || []).map((r) => r.id).filter(Boolean);
  return ids;
}

module.exports = async function handler(req, res) {
  try {
    if (!supabase) return json(res, 500, { ok: false, error: "MISSING_SUPABASE_ENV_VARS" });

    // allow GET or POST for cron convenience
    if (req.method !== "GET" && req.method !== "POST") {
      return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED_CRON" });
    }

    if (!Number.isFinite(RENDER_TTL_DAYS) || RENDER_TTL_DAYS <= 0) {
      return json(res, 400, { ok: false, error: "INVALID_RENDER_TTL_DAYS" });
    }

    const cutoff = cutoffIso(RENDER_TTL_DAYS);

    let totalFound = 0;
    let totalDeleted = 0;
    let totalVoiceRemoved = 0;

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const ids = await fetchOldRenderIds(cutoff, BATCH_SIZE);
      if (!ids.length) break;

      totalFound += ids.length;

      // best-effort: remove voice files first
      const voice = await removeVoiceFiles(ids);
      if (voice.removed) totalVoiceRemoved += voice.removed;

      // delete rows
      const del = await deleteRenderRows(ids);
      if (del.deleted) totalDeleted += del.deleted;

      // If DB delete failed, stop to avoid looping forever
      if (del.error) break;
    }

    return json(res, 200, {
      ok: true,
      cutoff,
      ttl_days: RENDER_TTL_DAYS,
      batch_size: BATCH_SIZE,
      max_loops: MAX_LOOPS,
      found: totalFound,
      deleted: totalDeleted,
      voice_files_removed: totalVoiceRemoved,
    });
  } catch (e) {
    console.error("[CLEANUP_RENDERS_ERROR]", e);
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
};
