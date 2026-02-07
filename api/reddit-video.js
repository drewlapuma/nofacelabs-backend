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

function ensurePublicHttpUrl(url, label) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("blob:")) throw new Error(`${label} is a blob: URL. Upload and send a public https URL.`);
  if (u.startsWith("data:")) throw new Error(`${label} is a data: URL. Upload and send a public https URL.`);
  if (!/^https?:\/\//i.test(u)) throw new Error(`${label} must be an http(s) URL.`);
  return u;
}

/**
 * Writes the same value to multiple modification paths.
 * This helps because sometimes Creatomate returns nested keys like:
 *  - post_card_light.icon_share.x
 * even if we originally set icon_share.x
 */
function setMulti(m, paths, value) {
  for (const p of paths) m[p] = value;
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

  const pfpUrl = ensurePublicHttpUrl(body.pfpUrl, "pfpUrl");
  const bgUrl = ensurePublicHttpUrl(body.backgroundVideoUrl, "backgroundVideoUrl");

  // ---- card bg geometry (from your template) ----
  // post_bg_light.width = "75%" centered at x=50%
  const BG_WIDTH = 75;
  const BG_CENTER_X = 50;
  const cardLeft = BG_CENTER_X - BG_WIDTH / 2;   // 12.5
  const cardRight = BG_CENTER_X + BG_WIDTH / 2;  // 87.5

  // ---- height logic (your existing approach) ----
  const charsPerLine = 36;
  const lineCount = Math.max(1, Math.ceil(postText.length / charsPerLine));
  const extraLines = Math.max(0, lineCount - 2);

  const baseBgH = 18;
  const baseBgY = 24.2746;
  const addPerLine = 2.8;

  let bgH = clamp(baseBgH + extraLines * addPerLine, baseBgH, 45);
  const deltaH = bgH - baseBgH;

  let bgY = baseBgY + deltaH / 2;

  // shrink bottom padding only when it grew (prevents blank space)
  const footerPadUp = clamp(deltaH * 0.22, 0, 1.5);
  bgH = clamp(bgH - footerPadUp * 2, baseBgH, 45);
  bgY = bgY - footerPadUp;

  // base Y positions from your template
  const BASE_Y = {
    like_count_y: 30.3637,
    comment_count_y: 30.3637,
    share_text_y: 30.5096,
    icon_like_y: 31.6571,
    icon_comment_y: 31.66,
    icon_share_y: 31.66,
  };

  const baseBottom = baseBgY + baseBgH / 2;
  const currentBottom = bgY + bgH / 2;

  const likeY = currentBottom - (baseBottom - BASE_Y.like_count_y);
  const commentY = currentBottom - (baseBottom - BASE_Y.comment_count_y);
  const shareTextY = currentBottom - (baseBottom - BASE_Y.share_text_y);
  const iconLikeY = currentBottom - (baseBottom - BASE_Y.icon_like_y);
  const iconCommentY = currentBottom - (baseBottom - BASE_Y.icon_comment_y);
  const iconShareY = currentBottom - (baseBottom - BASE_Y.icon_share_y);

   // ---- X layout fixes (updated spacing + collision-safe) ----
  const BASE_LIKE_TEXT_X = 19.0572;

  const BASE_COMMENT_ICON_X = 29.0172;
  const BASE_COMMENT_TEXT_X = 31.6676;

  // SHARE pinned to inside-right of card, grows LEFT
  const RIGHT_PAD = 3.2;
  const SHARE_TEXT_X = cardRight - RIGHT_PAD;

  const shareLen = String(shareText || "").length;
  const estShareTextW = clamp(shareLen * 1.7, 6, 42);

  // ✅ more gap so icon doesn't clip into share text
  const SHARE_ICON_GAP = 5.1; // was ~3.9
  const SHARE_ICON_X = SHARE_TEXT_X - estShareTextW - SHARE_ICON_GAP;

  // LIKE pushes comment group right (stronger)
  const likeLen = String(likes || "").length;
  const likeExtra = Math.max(0, likeLen - 3);

  let likeShift = likeExtra * 1.75;     // was 1.55
  likeShift = clamp(likeShift, 0, 30);  // a little more headroom

  // Start with shift-based position
  let commentTextX = BASE_COMMENT_TEXT_X + likeShift;
  let commentIconX = commentTextX - (BASE_COMMENT_TEXT_X - BASE_COMMENT_ICON_X);

  // ✅ GUARANTEE comment icon clears the rendered like text width
  const estLikeTextW = clamp(likeLen * 1.7, 6, 42);
  const LIKE_CLEAR_GAP = 4.0; // extra breathing room so it doesn't clip
  const minCommentIconX = BASE_LIKE_TEXT_X + estLikeTextW + LIKE_CLEAR_GAP;

  if (commentIconX < minCommentIconX) {
    commentIconX = minCommentIconX;
    commentTextX = commentIconX + (BASE_COMMENT_TEXT_X - BASE_COMMENT_ICON_X);
  }

  // ✅ also guarantee comment group never collides with share group
  const maxCommentTextX = SHARE_ICON_X - 7.0; // slightly more buffer than before
  if (commentTextX > maxCommentTextX) {
    commentTextX = maxCommentTextX;
    commentIconX = commentTextX - (BASE_COMMENT_TEXT_X - BASE_COMMENT_ICON_X);
  }


  // ---- build modifications ----
  const OP_ON = "100%";
  const OP_OFF = "0%";

  const m = {};

  // show/hide light/dark
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? OP_ON : OP_OFF;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? OP_ON : OP_OFF;

  // bg sizing (scoped + fallback)
  setMulti(m, ["post_bg_light.y", "post_card_light.post_bg_light.y"], pct(bgY));
  setMulti(m, ["post_bg_light.height", "post_card_light.post_bg_light.height"], pct(bgH));
  setMulti(m, ["post_bg_dark.y", "post_card_dark.post_bg_dark.y"], pct(bgY));
  setMulti(m, ["post_bg_dark.height", "post_card_dark.post_bg_dark.height"], pct(bgH));

  // content texts
  setMulti(m, ["username_light.text", "post_card_light.username_light.text"], username);
  setMulti(m, ["username_dark.text", "post_card_dark.username_dark.text"], username);

  setMulti(m, ["post_text_light.text", "post_card_light.post_text_light.text"], postText);
  setMulti(m, ["post_text_dark.text", "post_card_dark.post_text_dark.text"], postText);

  setMulti(m, ["like_count_light.text", "post_card_light.like_count_light.text"], likes);
  setMulti(m, ["like_count_dark.text", "post_card_dark.like_count_dark.text"], likes);

  setMulti(m, ["comment_count_light.text", "post_card_light.comment_count_light.text"], comments);
  setMulti(m, ["comment_count_dark.text", "post_card_dark.comment_count_dark.text"], comments);

  setMulti(m, ["share_light.text", "post_card_light.share_light.text"], shareText);
  setMulti(m, ["share_dark.text", "post_card_dark.share_dark.text"], shareText);

  // footer Y pinned to bg bottom
  setMulti(m, ["like_count_light.y", "post_card_light.like_count_light.y"], pct(likeY));
  setMulti(m, ["like_count_dark.y", "post_card_dark.like_count_dark.y"], pct(likeY));

  setMulti(m, ["comment_count_light.y", "post_card_light.comment_count_light.y"], pct(commentY));
  setMulti(m, ["comment_count_dark.y", "post_card_dark.comment_count_dark.y"], pct(commentY));

  setMulti(m, ["share_light.y", "post_card_light.share_light.y"], pct(shareTextY));
  setMulti(m, ["share_dark.y", "post_card_dark.share_dark.y"], pct(shareTextY));

  setMulti(m, ["icon_like.y", "post_card_light.icon_like.y", "post_card_dark.icon_like.y"], pct(iconLikeY));
  setMulti(m, ["icon_comment.y", "post_card_light.icon_comment.y", "post_card_dark.icon_comment.y"], pct(iconCommentY));
  setMulti(m, ["icon_share.y", "post_card_light.icon_share.y", "post_card_dark.icon_share.y"], pct(iconShareY));

  // ✅ LIKE pushes COMMENT group to the right (X)
  setMulti(m, ["icon_comment.x", "post_card_light.icon_comment.x", "post_card_dark.icon_comment.x"], pct(commentIconX));
  setMulti(m, ["comment_count_light.x", "post_card_light.comment_count_light.x"], pct(commentTextX));
  setMulti(m, ["comment_count_dark.x", "post_card_dark.comment_count_dark.x"], pct(commentTextX));

  // ✅ SHARE: text grows LEFT and icon always stays BEFORE it
  setMulti(m, ["share_light.x_anchor", "post_card_light.share_light.x_anchor"], "100%");
  setMulti(m, ["share_dark.x_anchor", "post_card_dark.share_dark.x_anchor"], "100%");

  setMulti(m, ["share_light.x", "post_card_light.share_light.x"], pct(SHARE_TEXT_X));
  setMulti(m, ["share_dark.x", "post_card_dark.share_dark.x"], pct(SHARE_TEXT_X));

  setMulti(m, ["icon_share.x", "post_card_light.icon_share.x", "post_card_dark.icon_share.x"], pct(SHARE_ICON_X));

  // sources
  if (pfpUrl) {
    setMulti(m, ["pfp_light.source", "post_card_light.pfp_light.source"], pfpUrl);
    setMulti(m, ["pfp_dark.source", "post_card_dark.pfp_dark.source"], pfpUrl);
  }
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
