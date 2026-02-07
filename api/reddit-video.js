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

function pct(n) {
  const v = Number(n);
  return `${Math.round(v * 1000) / 1000}%`;
}

/** ✅ ADDED: reject blob:/data: URLs early with a clear message */
function ensurePublicHttpUrl(url, label) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("blob:")) {
    throw new Error(
      `${label} is a blob: URL (browser-only). Upload the file to Supabase/R2 and send the public https URL instead.`
    );
  }
  if (u.startsWith("data:")) {
    throw new Error(
      `${label} is a data: URL. Upload the file to Supabase/R2 and send the public https URL instead.`
    );
  }
  if (!/^https?:\/\//i.test(u)) {
    throw new Error(`${label} must be an http(s) URL.`);
  }
  return u;
}

function buildModifications(body) {
  const mode = normalizeMode(body.mode);
  const showLight = mode === "light";
  const showDark = mode === "dark";

  const username = safeStr(body.username, "Nofacelabs.ai");
  const postText = safeStr(body.postText || body.postTitle, "—");
  const likes = safeStr(body.likes, "99+");
  const comments = safeStr(body.comments, "99+");
  const shareText = safeStr(body.shareText, "share");

  // ✅ make sure URLs are real public URLs
  const pfpUrl = ensurePublicHttpUrl(body.pfpUrl, "pfpUrl");
  const bgUrl = ensurePublicHttpUrl(body.backgroundVideoUrl, "backgroundVideoUrl");

  const charsPerLine = 36;
  const lineCount = Math.max(1, Math.ceil(postText.length / charsPerLine));
  const extraLines = Math.max(0, lineCount - 2);

  const baseBgH = 18;
  const baseBgY = 24.27;
  const addPerLine = 2.8;

  let bgH = clamp(baseBgH + extraLines * addPerLine, baseBgH, 45);
  const deltaH = bgH - baseBgH;

  const centerShift = deltaH / 2;
  let bgY = baseBgY + centerShift;

  const BASE = {
    like_count_y: 30.3637,
    comment_count_y: 30.3637,
    share_text_y: 30.5096,
    icon_like_y: 31.6571,
    icon_comment_y: 31.66,
    icon_share_y: 31.66,
  };

  // ✅ your “blank space fix” logic stays as-is
  const footerPadUp = clamp(0.1 + deltaH * 0.18, 0.65, 1.5);
  bgH = clamp(bgH - footerPadUp * 2, baseBgH, 45);
  bgY = bgY - footerPadUp;

  const baseBottom = baseBgY + baseBgH / 2;
  const currentBottom = bgY + bgH / 2;

  const distLike = baseBottom - BASE.like_count_y;
  const distComment = baseBottom - BASE.comment_count_y;
  const distShareText = baseBottom - BASE.share_text_y;
  const distIconLike = baseBottom - BASE.icon_like_y;
  const distIconComment = baseBottom - BASE.icon_comment_y;
  const distIconShare = baseBottom - BASE.icon_share_y;

  const likeY = currentBottom - distLike;
  const commentY = currentBottom - distComment;
  const shareTextY = currentBottom - distShareText;
  const iconLikeY = currentBottom - distIconLike;
  const iconCommentY = currentBottom - distIconComment;
  const iconShareY = currentBottom - distIconShare;

  const OP_ON = "100%";
  const OP_OFF = "0%";

  const m = {};

  // ---- show/hide cards (KEEP YOUR ORIGINAL OPACITY LOGIC) ----
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? OP_ON : OP_OFF;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? OP_ON : OP_OFF;

  // ---- bg rect (height/y) ----
  m["post_bg_light.hidden"] = !showLight;
  m["post_bg_light.opacity"] = showLight ? OP_ON : OP_OFF;
  m["post_bg_light.y"] = pct(bgY);
  m["post_bg_light.height"] = pct(bgH);

  m["post_bg_dark.hidden"] = !showDark;
  m["post_bg_dark.opacity"] = showDark ? OP_ON : OP_OFF;
  m["post_bg_dark.y"] = pct(bgY);
  m["post_bg_dark.height"] = pct(bgH);

  // ---- text ----
  m["username_light.text"] = username;
  m["username_dark.text"] = username;

  m["post_text_light.text"] = postText;
  m["post_text_dark.text"] = postText;

  const baseTextH = 10;
  const textH = clamp(baseTextH + deltaH * 0.75, baseTextH, 30);
  m["post_text_light.height"] = pct(textH);
  m["post_text_dark.height"] = pct(textH);

  // ---- footer text ----
  m["like_count_light.text"] = likes;
  m["like_count_dark.text"] = likes;

  m["comment_count_light.text"] = comments;
  m["comment_count_dark.text"] = comments;

  m["share_light.text"] = shareText;
  m["share_dark.text"] = shareText;

  // ---- footer Y pinned to bg bottom ----
  m["like_count_light.y"] = pct(likeY);
  m["like_count_dark.y"] = pct(likeY);

  m["comment_count_light.y"] = pct(commentY);
  m["comment_count_dark.y"] = pct(commentY);

  m["share_light.y"] = pct(shareTextY);
  m["share_dark.y"] = pct(shareTextY);

  m["icon_like.y"] = pct(iconLikeY);
  m["icon_comment.y"] = pct(iconCommentY);
  m["icon_share.y"] = pct(iconShareY);

  // ===============================
  // ✅ HORIZONTAL FOOTER LAYOUT (v2 using YOUR real X values)
  // - share grows to the right (card widens to the right)
  // - likes text pushes comment group right
  // ===============================

  // From your template JSON (all %)
  const BG_BASE_W = 75; // post_bg_light.width
  const BG_BASE_X = 50; // centered, x_anchor 50%

  const LIKE_ICON_X = 16.2;
  const LIKE_TEXT_X = 19.0572; // like_count_light.x (x_anchor 0)

  const COMMENT_ICON_X = 29.0172;
  const COMMENT_TEXT_X = 31.6676; // comment_count_light.x (x_anchor 0)

  const SHARE_ICON_X = 71.279;
  const SHARE_TEXT_X = 74.5318; // share_light.x (x_anchor 0)

  const shareLen = String(shareText || "").length;
  const likesLen = String(likes || "").length;

  const extraShareChars = Math.max(0, shareLen - 5); // "share" baseline
  const shareExtra = clamp(extraShareChars * 0.85, 0, 22); // % widen

  const extraLikeChars = Math.max(0, likesLen - 3); // "99+" baseline
  const commentsPush = clamp(extraLikeChars * 0.95, 0, 18); // % push right

  // Widen mostly based on share, lightly on likes (keeps left edge fixed)
  const widen = Math.max(shareExtra, commentsPush * 0.35);

  const newBgW = clamp(BG_BASE_W + widen, BG_BASE_W, 92);
  const newBgX = BG_BASE_X + (newBgW - BG_BASE_W) / 2;

  m["post_bg_light.width"] = pct(newBgW);
  m["post_bg_dark.width"] = pct(newBgW);
  m["post_bg_light.x"] = pct(newBgX);
  m["post_bg_dark.x"] = pct(newBgX);

  // Share group follows the widened right edge
  m["icon_share.x"] = pct(SHARE_ICON_X + widen);
  m["share_light.x"] = pct(SHARE_TEXT_X + widen);
  m["share_dark.x"] = pct(SHARE_TEXT_X + widen);

  // Likes stays anchored; comment group gets pushed right as likes grows
  m["icon_comment.x"] = pct(COMMENT_ICON_X + commentsPush);
  m["comment_count_light.x"] = pct(COMMENT_TEXT_X + commentsPush);
  m["comment_count_dark.x"] = pct(COMMENT_TEXT_X + commentsPush);

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

    // ---- GET: poll render status ----
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest(`/v1/renders/${encodeURIComponent(id)}`, "GET");
      const status = String(r?.status || "").toLowerCase();
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";
      return json(res, 200, { ok: true, status, url: finalUrl || null });
    }

    // ---- POST: start render ----
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
