// api/reddit-video.js (CommonJS, Node 18+)
// POST starts a Creatomate render (template mode)
// GET polls status
//
// Expects POST body:
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

/**
 * IMPORTANT:
 * Creatomate template modifications must be a flat object with dot-keys:
 *   "element.property": value
 * For text: ".text"
 * For images/videos: ".source"
 * For groups/shapes: ".opacity"
 */
function buildModifications(payload) {
  const mode = normalizeMode(payload.mode);

  const username = safeStr(payload.username, "Nofacelabs.ai");
  const postText = safeStr(payload.postText || payload.postTitle, "—");
  const likes = safeStr(payload.likes, "99+");
  const comments = safeStr(payload.comments, "99+");
  const shareText = safeStr(payload.shareText, "share");
  const pfpUrl = safeStr(payload.pfpUrl, "");
  const bgUrl = safeStr(payload.backgroundVideoUrl || payload.backgroundUrl, "");

  const showLight = mode === "light";
  const showDark = mode === "dark";

  const mods = {
    // --- TEXT (set BOTH where your template has light/dark variants) ---
    "username_light.text": username,
    "username_dark.text": username,

    // Your template uses post_text in both cards (per your screenshot)
    "post_text.text": postText,
    // If you also created variants later, set them too (harmless if missing)
    "post_text_light.text": postText,
    "post_text_dark.text": postText,

    "like_count.text": likes,
    "like_count_light.text": likes,
    "like_count_dark.text": likes,

    "comment_count.text": comments,
    "comment_count_light.text": comments,
    "comment_count_dark.text": comments,

    // share text exists in both cards in some versions
    "share.text": shareText,
    "share_light.text": shareText,
    "share_dark.text": shareText,

    // --- PFP (your screenshot shows pfp_light and pfp_dark) ---
    ...(pfpUrl
      ? {
          "pfp_light.source": pfpUrl,
          "pfp_dark.source": pfpUrl,
          // if you ever still have old name "pfp" somewhere, also set it
          "pfp.source": pfpUrl,
        }
      : {}),

    // --- Background video layer ---
    ...(bgUrl ? { "Video.source": bgUrl } : {}),

    // --- SHOW/HIDE cards ---
    "post_card_light.opacity": showLight ? 1 : 0,
    "post_card_dark.opacity": showDark ? 1 : 0,

    // --- Background shapes (your screenshot shows post_bg_light / post_bg_dark) ---
    "post_bg_light.opacity": showLight ? 1 : 0,
    "post_bg_dark.opacity": showDark ? 1 : 0,
  };

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
      postTitle: body.postTitle,
      postText: body.postText,
      likes: body.likes,
      comments: body.comments,
      shareText: body.shareText,
      script: body.script, // not used in template yet
      backgroundVideoUrl: body.backgroundVideoUrl || body.backgroundUrl,
    };

    if (!safeStr(payload.username)) {
      return json(res, 400, { ok: false, error: "Missing username" });
    }
    if (!safeStr(payload.postText || payload.postTitle)) {
      return json(res, 400, { ok: false, error: "Missing postText" });
    }
    if (!safeStr(payload.backgroundVideoUrl)) {
      return json(res, 400, { ok: false, error: "Missing backgroundVideoUrl (use library for now)" });
    }

    const modifications = buildModifications(payload);

    // Start render (template mode)
    const start = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,
      modifications, // ✅ flat dot-key object
      output_format: "mp4",
    });

    // Creatomate sometimes returns an array
    const first = Array.isArray(start) ? start[0] : start;
    const renderId = first?.id;

    if (!renderId) {
      return json(res, 500, {
        ok: false,
        error: "Creatomate did not return render id",
        raw: start,
      });
    }

    return json(res, 200, { ok: true, renderId, status: first?.status || "queued" });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
