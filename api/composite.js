// api/composite.js (CommonJS, Node 18+ on Vercel)

const https = require("https");
const { createClient } = require("@supabase/supabase-js");

// -------------------- CORS --------------------
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  // If you use Memberstack cookie sessions, you must NOT use "*"
  // You must echo the requesting origin and allow credentials.
  if (origin && (ALLOW_ORIGINS.length === 0 || ALLOW_ORIGINS.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return "__INVALID__";
  }
}

// -------------------- Creatomate helpers --------------------
function creatomateRequest(method, path, bodyObj) {
  const apiKey = process.env.CREATOMATE_API_KEY;
  if (!apiKey) throw new Error("Missing CREATOMATE_API_KEY env var");

  const body = bodyObj ? JSON.stringify(bodyObj) : null;

  const opts = {
    method,
    hostname: "api.creatomate.com",
    path,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        let j = {};
        try {
          j = JSON.parse(data || "{}");
        } catch {
          j = { raw: data };
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg =
            j?.error ||
            j?.message ||
            j?.raw ||
            `Creatomate HTTP ${res.statusCode}`;
          return reject(new Error(msg));
        }
        resolve(j);
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function normalizeTranscriptEffect(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;

  if (s === "highlighter" || s === "highlighted") return "highlight";
  if (s === "yellowpop" || s === "minttag" || s === "purplepop" || s === "redtag")
    return "highlight";

  const allowed = new Set([
    "color",
    "karaoke",
    "highlight",
    "fade",
    "bounce",
    "slide",
    "enlarge",
  ]);
  return allowed.has(s) ? s : null;
}

// -------------------- Supabase helpers --------------------
function getSupabaseAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function signedReadUrl(bucket, path, expiresIn = 3600) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    throw new Error(`Signed read URL error: ${error?.message || "Object not found"}`);
  }
  return data.signedUrl;
}

// -------------------- Template mapping --------------------
function buildModifications({ mainUrl, bgUrl, payload }) {
  // Set these env vars to match your template names
  const MAIN = process.env.COMPOSITE_MAIN_LAYER || "input_video_visual";
  const BG = process.env.COMPOSITE_BG_LAYER || "bg-video";

  // NOTE: You have multiple subtitle layers (Subtitles_Sentence, etc.)
  // We'll pick based on captions.style if you send it, else default to Sentence.
  const style = String(payload?.captions?.style || "Sentence");
  const SUB =
    process.env[`COMPOSITE_SUB_LAYER_${style.toUpperCase()}`] ||
    process.env.COMPOSITE_SUBTITLES_LAYER ||
    "Subtitles_Sentence";

  const GROUP_SIDE = process.env.COMPOSITE_GROUP_SIDE || "Layout_SideBySide";
  const GROUP_TB = process.env.COMPOSITE_GROUP_TOPBOTTOM || "Layout_TopBottom";

  const layout = payload.layout === "topBottom" ? "topBottom" : "sideBySide";
  const mainSlot = String(payload.mainSlot || (layout === "topBottom" ? "top" : "left"));

  const mainSpeed = Number(payload.mainSpeed || 1);
  const bgSpeed = Number(payload.bgSpeed || 1);
  const bgMuted = payload.bgMuted !== false;

  const cap = payload.captions || {};
  const capEnabled = cap.enabled !== false;

  const settings = cap.settings || {};
  const effectRaw =
    settings.transcript_effect ??
    settings.transcriptEffect ??
    settings.active_effect ??
    settings.activeEffect ??
    settings.effect ??
    cap.style;

  const transcript_effect = normalizeTranscriptEffect(effectRaw) || "color";

  const mods = [];

  // Sources
  mods.push({ name: MAIN, src: mainUrl });
  mods.push({ name: BG, src: bgUrl });

  // Speed
  mods.push({ name: MAIN, playback_rate: mainSpeed });
  mods.push({ name: BG, playback_rate: bgSpeed });

  // Mute background
  if (bgMuted) mods.push({ name: BG, volume: 0 });

  // Layout groups
  mods.push({ name: GROUP_SIDE, visible: layout === "sideBySide" });
  mods.push({ name: GROUP_TB, visible: layout === "topBottom" });

  // Slot groups (optional)
  mods.push({ name: "Main_Left", visible: mainSlot === "left" });
  mods.push({ name: "Main_Right", visible: mainSlot === "right" });
  mods.push({ name: "Main_Top", visible: mainSlot === "top" });
  mods.push({ name: "Main_Bottom", visible: mainSlot === "bottom" });

  // Captions
  mods.push({ name: SUB, visible: !!capEnabled });
  mods.push({ name: SUB, transcript_effect });

  const transcriptColor =
    settings.transcript_color ??
    settings.transcriptColor ??
    settings.activeColor ??
    settings.active_color;

  if (transcriptColor) {
    mods.push({ name: SUB, transcript_color: String(transcriptColor) });
  }

  return mods;
}

// -------------------- Handler --------------------
module.exports = async function handler(req, res) {
  // ✅ Always set CORS first
  setCors(req, res);

  // ✅ Never fail preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const BUCKET =
      process.env.SUPABASE_UPLOAD_BUCKET ||
      process.env.USER_VIDEOS_BUCKET ||
      "user-uploads";

    if (req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json(res, 400, { ok: false, error: "Missing body" });
      if (body === "__INVALID__") return json(res, 400, { ok: false, error: "Invalid JSON" });

      const templateId = process.env.COMPOSITE_TEMPLATE_ID;
      if (!templateId) {
        return json(res, 500, { ok: false, error: "Missing COMPOSITE_TEMPLATE_ID env var" });
      }

      const mainPath = body.mainPath;
      const backgroundPath = body.backgroundPath;
      const backgroundVideoUrl = body.backgroundVideoUrl;

      if (!mainPath) return json(res, 400, { ok: false, error: "mainPath is required" });
      if (!backgroundPath && !backgroundVideoUrl) {
        return json(res, 400, { ok: false, error: "backgroundPath or backgroundVideoUrl is required" });
      }

      const mainUrl = await signedReadUrl(BUCKET, mainPath, 60 * 60);
      const bgUrl = backgroundVideoUrl
        ? String(backgroundVideoUrl)
        : await signedReadUrl(BUCKET, backgroundPath, 60 * 60);

      const modifications = buildModifications({ mainUrl, bgUrl, payload: body });

      const created = await creatomateRequest("POST", "/v1/renders", {
        template_id: templateId,
        modifications,
        output_format: "mp4",
      });

      const item = Array.isArray(created) ? created[0] : created;
      const renderId = item?.id;
      const status = item?.status || "planned";

      if (!renderId) {
        return json(res, 500, {
          ok: false,
          error: "Creatomate render response missing id",
          details: created,
        });
      }

      return json(res, 200, { ok: true, renderId, status });
    }

    if (req.method === "GET") {
      const id = String(req.query?.id || "").trim();
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest("GET", `/v1/renders/${encodeURIComponent(id)}`, null);

      const status = String(r?.status || "").toLowerCase();
      const url = r?.url || r?.output_url || null;

      if (status === "failed") {
        return json(res, 200, {
          ok: true,
          status: "failed",
          error: r?.error || r?.message || "Render failed",
        });
      }

      if (status === "succeeded" && url) {
        return json(res, 200, { ok: true, status: "succeeded", url });
      }

      return json(res, 200, { ok: true, status: r?.status || "processing" });
    }

    return json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    console.error("COMPOSITE_ERROR:", err);
    return json(res, 500, { ok: false, error: err?.message || String(err) });
  }
};
