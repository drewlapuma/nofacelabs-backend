// api/reddit-video.js (CommonJS, Node 18+)
// POST starts a Creatomate template render
// GET polls status
//
// POST body expected:
// {
//   username, mode, pfpUrl,
//   postTitle, postText,
//   likes, comments, shareText,
//   script,
//   backgroundVideoUrl
// }
//
// Env:
// - CREATOMATE_API_KEY
// - CREATOMATE_TEMPLATE_ID_REDDIT
// - ALLOW_ORIGIN or ALLOW_ORIGINS (optional)

const https = require("https");

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID_REDDIT;

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;

  if (ALLOW_ORIGINS.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) return resolve(req.body);
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function safeStr(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function normalizeMode(v) {
  const s = String(v || "").toLowerCase().trim();
  return s === "dark" ? "dark" : "light";
}

function pickBackgroundUrl(body) {
  return (
    safeStr(body.backgroundVideoUrl) ||
    safeStr(body.background_url) ||
    safeStr(body.backgroundUrl) ||
    safeStr(body.bgUrl) ||
    safeStr(body.bg_url) ||
    ""
  );
}

// ✅ Creatomate request wrapper that returns { ok, status, json, raw }
function creatomateRequest(path, method, payload) {
  return new Promise((resolve, reject) => {
    if (!CREATOMATE_API_KEY) return reject(new Error("Missing CREATOMATE_API_KEY"));

    const body = payload ? JSON.stringify(payload) : "";
    const req = https.request(
      {
        hostname: "api.creatomate.com",
        path,
        method,
        headers: {
          Authorization: `Bearer ${CREATOMATE_API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          const status = res.statusCode || 0;

          let parsed = null;
          try {
            parsed = JSON.parse(out || "{}");
          } catch {
            parsed = null;
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: parsed,
            raw: out,
          });
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/**
 * ✅ IMPORTANT: For TEMPLATE renders, modifications MUST BE AN OBJECT.
 * Keys must match your layer names exactly:
 * - username
 * - post_text
 * - like_count
 * - comment_count
 * - share
 * - pfp
 * - post_card_light
 * - post_card_dark
 * - post_bg_dark (optional)
 * - Video
 */
function buildModificationsObject(payload) {
  const mode = normalizeMode(payload.mode);

  const username = safeStr(payload.username, "Nofacelabs.ai");
  const postText = safeStr(payload.postText, "—");
  const likes = safeStr(payload.likes, "99+");
  const comments = safeStr(payload.comments, "99+");
  const shareText = safeStr(payload.shareText, "share");

  const pfpUrl = safeStr(payload.pfpUrl, "");
  const bgUrl = safeStr(payload.backgroundVideoUrl, "");

  const showLight = mode === "light";
  const showDark = mode === "dark";

  const mods = {
    // text layers
    username: { text: username },
    post_text: { text: postText },
    like_count: { text: likes },
    comment_count: { text: comments },
    share: { text: shareText },

    // show/hide groups (opacity works on groups/shapes)
    post_card_light: { opacity: showLight ? 1 : 0 },
    post_card_dark: { opacity: showDark ? 1 : 0 },

    // optional
    post_bg_dark: { opacity: showDark ? 1 : 0 },
  };

  // image layer
  if (pfpUrl) mods.pfp = { source: pfpUrl };

  // video layer
  if (bgUrl) mods.Video = { source: bgUrl };

  return mods;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();

  try {
    if (!TEMPLATE_ID) {
      return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_REDDIT" });
    }

    // ---- GET: poll render status ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest(`/v1/renders/${encodeURIComponent(id)}`, "GET");
      if (!r.ok) {
        return json(res, 400, {
          ok: false,
          error: "Creatomate poll error",
          status: r.status,
          creatomate: r.json || r.raw,
        });
      }

      const data = r.json || {};
      const status = String(data?.status || "").toLowerCase();
      const finalUrl = data?.url || data?.result?.url || data?.outputs?.[0]?.url || "";

      return json(res, 200, {
        ok: true,
        status,
        url: finalUrl || null,
        raw: finalUrl ? undefined : data,
      });
    }

    // ---- POST: start render ----
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Use POST or GET" });
    }

    const body = await readBody(req);

    const payload = {
      username: body.username,
      mode: body.mode,
      pfpUrl: body.pfpUrl,
      postText: body.postText || body.post_title || body.postTitle || "",
      likes: body.likes,
      comments: body.comments,
      shareText: body.shareText,
      script: body.script,
      backgroundVideoUrl: pickBackgroundUrl(body),
    };

    if (!safeStr(payload.username)) return json(res, 400, { ok: false, error: "Missing username" });
    if (!safeStr(payload.postText)) return json(res, 400, { ok: false, error: "Missing postText" });
    if (!safeStr(payload.backgroundVideoUrl)) {
      return json(res, 400, {
        ok: false,
        error: "Missing backgroundVideoUrl (your frontend isn’t sending it)",
      });
    }

    const modifications = buildModificationsObject(payload);

    // ✅ debug
    console.log("[reddit-video] start payload:", {
      template_id: TEMPLATE_ID,
      mode: payload.mode,
      backgroundVideoUrl: payload.backgroundVideoUrl,
      pfpUrl: payload.pfpUrl ? "(set)" : "(empty)",
      postTextLen: String(payload.postText || "").length,
      keys: Object.keys(modifications),
    });

    const start = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,

      // ✅ FIX: must be an OBJECT, not array
      modifications,

      // Optional but fine:
      output_format: "mp4",
    });

    if (!start.ok) {
      console.error("[reddit-video] Creatomate failed:", start.status, start.raw);
      return json(res, 400, {
        ok: false,
        error: "Creatomate HTTP " + start.status,
        status: start.status,
        creatomate: start.json || start.raw,
        sent: {
          template_id: TEMPLATE_ID,
          backgroundVideoUrl: payload.backgroundVideoUrl,
          pfpUrl: payload.pfpUrl,
          mode: payload.mode,
          modificationsKeys: Object.keys(modifications),
          modifications,
        },
      });
    }

    const startJson = start.json || {};
    const renderId = startJson?.id;

    if (!renderId) {
      return json(res, 500, {
        ok: false,
        error: "Creatomate did not return render id",
        raw: startJson,
      });
    }

    return json(res, 200, { ok: true, renderId, status: startJson?.status || "queued" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
