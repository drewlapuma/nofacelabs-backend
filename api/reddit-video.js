// api/reddit-video.js (CommonJS, Node 18+)

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
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          let j;
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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * KEY CHANGE:
 * - Do NOT move/resize post_card_* groups (that causes child elements to “double move” if we also move children)
 * - Only resize/move post_bg_* (background rect) + expand post_text_* (text box height)
 * - Leave footer/icons alone so they stay aligned.
 */
function buildModifications(body) {
  const mode = normalizeMode(body.mode);
  const showLight = mode === "light";
  const showDark = mode === "dark";

  const username = safeStr(body.username, "Nofacelabs.ai");
  const postText = safeStr(body.postText || body.postTitle, "—");
  const likes = safeStr(body.likes, "99+");
  const comments = safeStr(body.comments, "99+");
  const shareText = safeStr(body.shareText, "share");
  const pfpUrl = safeStr(body.pfpUrl, "");
  const bgUrl = safeStr(body.backgroundVideoUrl, "");

  // ---- estimate lines for growth ----
  const charsPerLine = 36; // tweak if needed
  const lineCount = Math.max(1, Math.ceil(postText.length / charsPerLine));
  const extraLines = Math.max(0, lineCount - 2);

  // Your base background rect size (matches your card feel)
  const baseBgH = 18;        // %
  const baseBgY = 24.27;     // %
  const addPerLine = 2.8;    // % per extra line

  const bgH = clamp(baseBgH + extraLines * addPerLine, baseBgH, 45);
  const deltaH = bgH - baseBgH;

  // Move bg down by delta/2 so the TOP stays steady (no “space at top”)
  const bgY = baseBgY + deltaH / 2;

  const OP_ON = "100%";
  const OP_OFF = "0%";

  const m = {};

  // ---- show/hide groups + backgrounds ----
  // IMPORTANT: we DO NOT change post_card_* y/height at all anymore.
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? OP_ON : OP_OFF;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? OP_ON : OP_OFF;

  // Resize the background rectangles (these can safely resize)
  m["post_bg_light.hidden"] = !showLight;
  m["post_bg_light.opacity"] = showLight ? OP_ON : OP_OFF;
  m["post_bg_light.y"] = `${bgY}%`;
  m["post_bg_light.height"] = `${bgH}%`;

  m["post_bg_dark.hidden"] = !showDark;
  m["post_bg_dark.opacity"] = showDark ? OP_ON : OP_OFF;
  m["post_bg_dark.y"] = `${bgY}%`;
  m["post_bg_dark.height"] = `${bgH}%`;

  // ---- text fields (your exact names) ----
  m["username_light.text"] = username;
  m["username_dark.text"] = username;

  m["post_text_light.text"] = postText;
  m["post_text_dark.text"] = postText;

  // Expand the post text box height so wrapping can happen inside the card
  // (This is what prevents “text runs off card”)
  // We grow text box height by most of deltaH, but leave space for header + footer.
  const baseTextH = 10; // safe default; tweak if your post_text box is different
  const textH = clamp(baseTextH + deltaH * 0.75, baseTextH, 30);

  m["post_text_light.height"] = `${textH}%`;
  m["post_text_dark.height"] = `${textH}%`;

  m["like_count_light.text"] = likes;
  m["like_count_dark.text"] = likes;

  m["comment_count_light.text"] = comments;
  m["comment_count_dark.text"] = comments;

  m["share_light.text"] = shareText;
  m["share_dark.text"] = shareText;

  // ---- images ----
  if (pfpUrl) {
    m["pfp_light.source"] = pfpUrl;
    m["pfp_dark.source"] = pfpUrl;
  }

  // ---- video ----
  if (bgUrl) {
    m["Video.source"] = bgUrl;
  }

  return m;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();

  try {
    if (!TEMPLATE_ID) {
      return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_REDDIT" });
    }

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest(`/v1/renders/${encodeURIComponent(id)}`, "GET");
      const status = String(r?.status || "").toLowerCase();
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";
      return json(res, 200, { ok: true, status, url: finalUrl || null });
    }

    if (req.method !== "POST") {
      return json(res, 405, { ok: false, error: "Use POST or GET" });
    }

    const body = await readBody(req);

    const username = safeStr(body.username);
    const postText = safeStr(body.postText || body.postTitle);
    const backgroundVideoUrl = safeStr(body.backgroundVideoUrl);

    if (!username) return json(res, 400, { ok: false, error: "Missing username" });
    if (!postText) return json(res, 400, { ok: false, error: "Missing postText" });
    if (!backgroundVideoUrl) {
      return json(res, 400, { ok: false, error: "Missing backgroundVideoUrl (use library for now)" });
    }

    const modifications = buildModifications(body);

    const startResp = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,
      modifications,
      output_format: "mp4",
      render_scale: 1,
    });

    const start = Array.isArray(startResp) ? startResp[0] : startResp;
    const renderId = start?.id;

    if (!renderId) {
      return json(res, 500, {
        ok: false,
        error: "Creatomate did not return render id",
        raw: startResp,
      });
    }

    return json(res, 200, {
      ok: true,
      renderId,
      status: start?.status || "queued",
      modificationsPreview: modifications,
    });
  } catch (e) {
    console.error(e);
    return json(res, 500, { ok: false, error: String(e?.message || e) });
  }
};
