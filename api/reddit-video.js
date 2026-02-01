// api/reddit-video.js (CommonJS, Node 18+)
// POST starts a Creatomate render
// GET polls status
//
// POST body expected (from your Webflow UI):
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
// - CREATOMATE_TEMPLATE_ID_REDDIT   (your template ID)
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

// ---- IMPORTANT: LAYER NAMES (from your screenshot) ----
// Text:
//  - username
//  - post_text
//  - like_count
//  - comment_count
//  - share        (text next to share icon)
// Images:
//  - pfp
// Groups / shapes:
//  - post_card_light
//  - post_card_dark
//  - post_bg_dark  (optional; exists in your layer list)
// Video:
//  - Video         (I saw "Video" in your layer list)
function buildModifications(payload) {
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

  const mods = [
    // --- text fields ---
    { name: "username", type: "text", text: username },
    { name: "post_text", type: "text", text: postText },
    { name: "like_count", type: "text", text: likes },
    { name: "comment_count", type: "text", text: comments },
    { name: "share", type: "text", text: shareText },

    // --- theme toggle (show one card, hide the other) ---
    // Creatomate supports "opacity" on any element, including groups.
    { name: "post_card_light", type: "shape", opacity: showLight ? 1 : 0 },
    { name: "post_card_dark", type: "shape", opacity: showDark ? 1 : 0 },

    // Optional: if you use a dark background rect
    { name: "post_bg_dark", type: "shape", opacity: showDark ? 1 : 0 },

    // --- gameplay video ---
    // Set your gameplay layer named "Video"
    ...(bgUrl ? [{ name: "Video", type: "video", source: bgUrl }] : []),
  ];

  // --- profile picture ---
  // If empty, your template's default stays.
  if (pfpUrl) {
    mods.push({ name: "pfp", type: "image", source: pfpUrl });
  }

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
      const status = String(r?.status || "").toLowerCase();

      // Creatomate usually returns result URL in "url"
      // Sometimes "result" or "outputs" exist depending on API mode.
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";

      return json(res, 200, {
        ok: true,
        status,
        url: finalUrl || null,
        raw: finalUrl ? undefined : r,
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
      postText: body.postText,
      likes: body.likes,
      comments: body.comments,
      shareText: body.shareText,
      script: body.script, // (not used in template yet; you’ll use this later for voice/captions)
      backgroundVideoUrl: body.backgroundVideoUrl,
    };

    if (!safeStr(payload.username)) return json(res, 400, { ok: false, error: "Missing username" });
    if (!safeStr(payload.postText)) return json(res, 400, { ok: false, error: "Missing postText" });
    if (!safeStr(payload.backgroundVideoUrl))
      return json(res, 400, { ok: false, error: "Missing backgroundVideoUrl (use library for now)" });

    const modifications = buildModifications(payload);

    // Start render (template mode)
    const start = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,
      modifications,
      // Optional:
      // "output_format": "mp4",
      // "render_scale": 1
    });

    // Creatomate render id is usually start.id
    const renderId = start?.id;
    if (!renderId) {
      return json(res, 500, { ok: false, error: "Creatomate did not return render id", raw: start });
    }

    return json(res, 200, { ok: true, renderId, status: start?.status || "queued" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
