// api/reddit-video.js (CommonJS, Node 18+)
// POST starts a Creatomate render
// GET polls status
//
// Expected POST body (from Webflow UI):
// {
//   username, mode, pfpUrl,
//   postTitle, postText,
//   likes, comments, shareText,
//   script,
//   backgroundVideoUrl, backgroundVideoName
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
          let j = {};
          try {
            j = JSON.parse(out || "{}");
          } catch {
            j = { raw: out };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j);
          const msg = j?.error || j?.message || j?.raw || `Creatomate HTTP ${res.statusCode}`;
          reject(new Error(msg));
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
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

function parseUrlParam(req, key) {
  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

// ---- helpers to build modifications as OBJECT ----
function setText(mods, names, text) {
  const t = safeStr(text, "");
  if (!t) return;
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    mods[name] = { text: t };
  });
}

function setOpacity(mods, names, opacity) {
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    mods[name] = { opacity: Number(opacity) };
  });
}

function setImage(mods, names, url) {
  const u = safeStr(url, "");
  if (!u) return;
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    mods[name] = { source: u };
  });
}

function setVideo(mods, names, url) {
  const u = safeStr(url, "");
  if (!u) return;
  (Array.isArray(names) ? names : [names]).forEach((name) => {
    mods[name] = { source: u };
  });
}

/**
 * IMPORTANT:
 * If your template layer names are different (case sensitive),
 * this sends multiple aliases so at least one hits.
 *
 * You can still simplify later by renaming your Creatomate layers
 * to ONE consistent naming scheme.
 */
function buildModifications(payload) {
  const mode = normalizeMode(payload.mode);

  const username = safeStr(payload.username, "Nofacelabs.ai");
  const postText = safeStr(payload.postText || payload.postTitle, "—");
  const likes = safeStr(payload.likes, "99+");
  const comments = safeStr(payload.comments, "99+");
  const shareText = safeStr(payload.shareText, "share");

  const pfpUrl = safeStr(payload.pfpUrl, "");
  const bgUrl = safeStr(payload.backgroundVideoUrl, "");

  const mods = {};

  // ---- TEXT aliases (hit whichever exists) ----
  setText(mods, ["username", "Username", "user_name", "user"], username);

  // Your screenshot said: post_text
  // But templates often use: postTitle, title, post_title, postText, etc.
  setText(mods, ["post_text", "postText", "post_title", "postTitle", "title", "Title"], postText);

  setText(mods, ["like_count", "likes", "Likes", "likeCount"], likes);
  setText(mods, ["comment_count", "comments", "Comments", "commentCount"], comments);
  setText(mods, ["share", "share_text", "shareText", "Share"], shareText);

  // ---- THEME group aliases ----
  const showLight = mode === "light";
  const showDark = mode === "dark";

  // If these are groups/shapes in your template, opacity works
  setOpacity(mods, ["post_card_light", "card_light", "light_card", "postCardLight"], showLight ? 1 : 0);
  setOpacity(mods, ["post_card_dark", "card_dark", "dark_card", "postCardDark"], showDark ? 1 : 0);
  setOpacity(mods, ["post_bg_dark", "bg_dark", "dark_bg", "postBgDark"], showDark ? 1 : 0);

  // ---- MEDIA aliases ----
  setImage(mods, ["pfp", "PFP", "avatar", "profile_pic", "profile_picture"], pfpUrl);

  // Your screenshot said: Video
  // Some templates use: background, bg_video, gameplay, etc.
  setVideo(mods, ["Video", "video", "background", "background_video", "backgroundVideo", "gameplay"], bgUrl);

  return mods;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();

  const debug = parseUrlParam(req, "debug") === "1";

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
      const status = String(r?.status || "").toLowerCase();
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";

      return json(res, 200, {
        ok: true,
        status,
        url: finalUrl || null,
        raw: debug ? r : undefined,
      });
    }

    // ---- POST: start render ----
    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Use POST or GET" });
    }

    const body = await readBody(req);

    // Accept a few possible background keys (your UI uses backgroundVideoUrl)
    const backgroundVideoUrl =
      body.backgroundVideoUrl ||
      body.background_video_url ||
      body.background ||
      body.videoUrl ||
      body.bgUrl ||
      "";

    const payload = {
      username: body.username,
      mode: body.mode,
      pfpUrl: body.pfpUrl,
      postTitle: body.postTitle,
      postText: body.postText,
      likes: body.likes,
      comments: body.comments,
      shareText: body.shareText,
      script: body.script,
      backgroundVideoUrl,
    };

    if (!safeStr(payload.username)) return json(res, 400, { ok: false, error: "Missing username" });
    if (!safeStr(payload.postText || payload.postTitle))
      return json(res, 400, { ok: false, error: "Missing postText/postTitle" });
    if (!safeStr(payload.backgroundVideoUrl))
      return json(res, 400, { ok: false, error: "Missing backgroundVideoUrl (use library for now)" });

    const modifications = buildModifications(payload);

    // Start render (template mode)
    const start = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,
      modifications, // ✅ must be OBJECT
      output_format: "mp4",
    });

    // Creatomate sometimes returns an ARRAY with one render when batching is enabled
    const renderId = start?.id || (Array.isArray(start) ? start?.[0]?.id : null);

    if (!renderId) {
      return json(res, 500, {
        ok: false,
        error: "Creatomate did not return render id",
        raw: debug ? start : undefined,
      });
    }

    return json(res, 200, {
      ok: true,
      renderId,
      status: start?.status || (Array.isArray(start) ? start?.[0]?.status : "queued"),
      // helpful debug so you can confirm keys being sent
      sent: debug ? { template_id: TEMPLATE_ID, modifications } : undefined,
    });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
