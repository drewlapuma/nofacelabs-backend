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

/** reject blob:/data: URLs early (Creatomate can't fetch them) */
function ensurePublicHttpUrl(url, label) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("blob:")) {
    throw new Error(
      `${label} is a blob: URL (browser-only). Upload to Supabase/R2 and send the public https URL instead.`
    );
  }
  if (u.startsWith("data:")) {
    throw new Error(
      `${label} is a data: URL. Upload to Supabase/R2 and send the public https URL instead.`
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

  const pfpUrl = ensurePublicHttpUrl(body.pfpUrl, "pfpUrl");
  const bgUrl = ensurePublicHttpUrl(body.backgroundVideoUrl, "backgroundVideoUrl");

  // ---------- text -> background sizing ----------
  const charsPerLine = 36;
  const lineCount = Math.max(1, Math.ceil(postText.length / charsPerLine));
  const extraLines = Math.max(0, lineCount - 2);

  const baseBgH = 18;
  const baseBgY = 24.2746;
  const addPerLine = 2.8;

  let bgH = clamp(baseBgH + extraLines * addPerLine, baseBgH, 45);
  const deltaH = bgH - baseBgH;

  // Center the bg while it grows
  let bgY = baseBgY + deltaH / 2;

  // ✅ IMPORTANT FIX:
  // Only trim the bottom when bg actually grew (deltaH > 0).
  // This prevents short titles from having footer too close.
  const footerPadUp = clamp(deltaH * 0.22, 0, 1.5); // 0..1.5
  bgH = clamp(bgH - footerPadUp * 2, baseBgH, 45);
  bgY = bgY - footerPadUp;

  // ---------- header top padding reduction ----------
  // Move header group up slightly (pfp/username/flairs)
  const headerLift = 0.55;

  // ---------- footer anchoring ----------
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

  const distLike = baseBottom - BASE_Y.like_count_y;
  const distComment = baseBottom - BASE_Y.comment_count_y;
  const distShareText = baseBottom - BASE_Y.share_text_y;
  const distIconLike = baseBottom - BASE_Y.icon_like_y;
  const distIconComment = baseBottom - BASE_Y.icon_comment_y;
  const distIconShare = baseBottom - BASE_Y.icon_share_y;

  const likeY = currentBottom - distLike;
  const commentY = currentBottom - distComment;
  const shareTextY = currentBottom - distShareText;
  const iconLikeY = currentBottom - distIconLike;
  const iconCommentY = currentBottom - distIconComment;
  const iconShareY = currentBottom - distIconShare;

  // ---------- X layout fixes for long counts ----------
  // Base X from your template JSON
  const BASE_X = {
    like_text_x: 19.0572,
    comment_icon_x: 29.0172,
    comment_text_x: 31.6676,
    share_icon_x: 71.279,
    share_text_x: 74.5318,
    bg_width: 75.0,
    bg_x_anchor: 50.0, // implied by x_anchor 50%
  };

  // 1) Likes pushes comment group to the right
  // baseline is "99+" (3 chars). Add shift per extra char.
  const likeExtra = Math.max(0, String(likes).length - 3);
  let likeShift = likeExtra * 0.85; // % per char (tune 0.6-1.0)

  // cap so comment doesn't run into share area
  // keep at least ~10% gap before share icon
  const maxShift = (BASE_X.share_icon_x - 10) - BASE_X.comment_text_x;
  likeShift = clamp(likeShift, 0, maxShift);

  const commentIconX = BASE_X.comment_icon_x + likeShift;
  const commentTextX = BASE_X.comment_text_x + likeShift;

  // 2) Share text: extend card bg to the right if share is long
  // baseline "share" (5 chars)
  const shareExtra = Math.max(0, String(shareText).length - 5);

  // grow bg width up to +12%
  const bgExtraW = clamp(shareExtra * 0.65, 0, 12);

  // Keep left edge same (original left edge is 50 - 75/2 = 12.5)
  // If we increase width by bgExtraW, shift bg center right by bgExtraW/2
  const bgW = BASE_X.bg_width + bgExtraW;
  const bgCenterX = 50 + bgExtraW / 2;

  // (We do NOT move the footer elements; they stay in same coordinate system,
  // so the new white bg covers the area under long share text.)

  const OP_ON = "100%";
  const OP_OFF = "0%";

  const m = {};

  // show/hide modes
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? OP_ON : OP_OFF;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? OP_ON : OP_OFF;

  // bg position/size (and width expansion to right)
  m["post_bg_light.hidden"] = !showLight;
  m["post_bg_light.opacity"] = showLight ? OP_ON : OP_OFF;
  m["post_bg_light.y"] = pct(bgY);
  m["post_bg_light.height"] = pct(bgH);
  m["post_bg_light.width"] = pct(bgW);
  m["post_bg_light.x"] = pct(bgCenterX);

  m["post_bg_dark.hidden"] = !showDark;
  m["post_bg_dark.opacity"] = showDark ? OP_ON : OP_OFF;
  m["post_bg_dark.y"] = pct(bgY);
  m["post_bg_dark.height"] = pct(bgH);
  m["post_bg_dark.width"] = pct(bgW);
  m["post_bg_dark.x"] = pct(bgCenterX);

  // header lift (reduce top padding)
  // (These names exist in your template: pfp_light, username_light, flair1..10, and dark versions)
  m["pfp_light.y"] = pct(19.5679 - headerLift);
  m["username_light.y"] = pct(16.8449 - headerLift);
  for (let i = 1; i <= 10; i++) m[`flair${i}.y`] = pct(20.9268 - headerLift);

  // if you also have dark versions named similarly:
  m["pfp_dark.y"] = pct(19.5679 - headerLift);
  m["username_dark.y"] = pct(16.8449 - headerLift);

  // text content
  m["username_light.text"] = username;
  m["username_dark.text"] = username;

  m["post_text_light.text"] = postText;
  m["post_text_dark.text"] = postText;

  // text height scaling
  const baseTextH = 10;
  const textH = clamp(baseTextH + deltaH * 0.75, baseTextH, 30);
  m["post_text_light.height"] = pct(textH);
  m["post_text_dark.height"] = pct(textH);

  // footer text
  m["like_count_light.text"] = likes;
  m["like_count_dark.text"] = likes;

  m["comment_count_light.text"] = comments;
  m["comment_count_dark.text"] = comments;

  m["share_light.text"] = shareText;
  m["share_dark.text"] = shareText;

  // footer Y pinned to bg bottom
  m["like_count_light.y"] = pct(likeY);
  m["like_count_dark.y"] = pct(likeY);

  m["comment_count_light.y"] = pct(commentY);
  m["comment_count_dark.y"] = pct(commentY);

  m["share_light.y"] = pct(shareTextY);
  m["share_dark.y"] = pct(shareTextY);

  m["icon_like.y"] = pct(iconLikeY);
  m["icon_comment.y"] = pct(iconCommentY);
  m["icon_share.y"] = pct(iconShareY);

  // ✅ comment group X push when likes are long
  m["icon_comment.x"] = pct(commentIconX);
  m["comment_count_light.x"] = pct(commentTextX);
  m["comment_count_dark.x"] = pct(commentTextX);

  // set sources
  if (pfpUrl) {
    m["pfp_light.source"] = pfpUrl;
    m["pfp_dark.source"] = pfpUrl;
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
