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
  if (u.startsWith("blob:")) {
    throw new Error(`${label} is a blob: URL. Upload to Supabase/R2 and send the public https URL.`);
  }
  if (u.startsWith("data:")) {
    throw new Error(`${label} is a data: URL. Upload to Supabase/R2 and send the public https URL.`);
  }
  if (!/^https?:\/\//i.test(u)) {
    throw new Error(`${label} must be an http(s) URL.`);
  }
  return u;
}

// helper: set same prop in multiple possible paths
function setMulti(m, paths, value) {
  paths.forEach((p) => (m[p] = value));
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

  // -------- card height logic (your existing behavior) --------
  const charsPerLine = 36;
  const lineCount = Math.max(1, Math.ceil(postText.length / charsPerLine));
  const extraLines = Math.max(0, lineCount - 2);

  const baseBgH = 18;
  const baseBgY = 24.2746;
  const addPerLine = 2.8;

  let bgH = clamp(baseBgH + extraLines * addPerLine, baseBgH, 45);
  const deltaH = bgH - baseBgH;

  let bgY = baseBgY + deltaH / 2;

  // only trim when it grew (prevents short titles crushing footer)
  const footerPadUp = clamp(deltaH * 0.22, 0, 1.5);
  bgH = clamp(bgH - footerPadUp * 2, baseBgH, 45);
  bgY = bgY - footerPadUp;

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

  // -------- X layout fixes --------
  // baseline values from your JSON:
  const BASE_X = {
    comment_icon_x: 29.0172,
    comment_text_x: 31.6676,
  };

  // Likes pushes comment group right
  const likeExtra = Math.max(0, String(likes).length - 3); // baseline "99+"
  let likeShift = likeExtra * 0.85; // % per extra char
  likeShift = clamp(likeShift, 0, 18); // hard cap to avoid insanity

  const commentIconX = BASE_X.comment_icon_x + likeShift;
  const commentTextX = BASE_X.comment_text_x + likeShift;

  // Share text: keep it INSIDE the card by anchoring to the right
  // This makes it grow LEFT instead of going off the right edge.
  const SHARE_RIGHT_X = 92.5; // tweak 90-95 for “right padding”
  const SHARE_ICON_X = 88.5;  // keep icon just left of text

  const OP_ON = "100%";
  const OP_OFF = "0%";

  const m = {};

  // show/hide modes
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? OP_ON : OP_OFF;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? OP_ON : OP_OFF;

  // bg size
  // IMPORTANT: set BOTH unscoped and scoped, because your bg is inside the composition.
  setMulti(m, ["post_bg_light.y", "post_card_light.post_bg_light.y"], pct(bgY));
  setMulti(m, ["post_bg_light.height", "post_card_light.post_bg_light.height"], pct(bgH));

  setMulti(m, ["post_bg_dark.y", "post_card_dark.post_bg_dark.y"], pct(bgY));
  setMulti(m, ["post_bg_dark.height", "post_card_dark.post_bg_dark.height"], pct(bgH));

  // text content
  setMulti(m, ["username_light.text", "post_card_light.username_light.text"], username);
  setMulti(m, ["username_dark.text", "post_card_dark.username_dark.text"], username);

  setMulti(m, ["post_text_light.text", "post_card_light.post_text_light.text"], postText);
  setMulti(m, ["post_text_dark.text", "post_card_dark.post_text_dark.text"], postText);

  // footer text
  setMulti(m, ["like_count_light.text", "post_card_light.like_count_light.text"], likes);
  setMulti(m, ["like_count_dark.text", "post_card_dark.like_count_dark.text"], likes);

  setMulti(m, ["comment_count_light.text", "post_card_light.comment_count_light.text"], comments);
  setMulti(m, ["comment_count_dark.text", "post_card_dark.comment_count_dark.text"], comments);

  setMulti(m, ["share_light.text", "post_card_light.share_light.text"], shareText);
  setMulti(m, ["share_dark.text", "post_card_dark.share_dark.text"], shareText);

  // footer Y pinned
  setMulti(m, ["like_count_light.y", "post_card_light.like_count_light.y"], pct(likeY));
  setMulti(m, ["like_count_dark.y", "post_card_dark.like_count_dark.y"], pct(likeY));

  setMulti(m, ["comment_count_light.y", "post_card_light.comment_count_light.y"], pct(commentY));
  setMulti(m, ["comment_count_dark.y", "post_card_dark.comment_count_dark.y"], pct(commentY));

  setMulti(m, ["share_light.y", "post_card_light.share_light.y"], pct(shareTextY));
  setMulti(m, ["share_dark.y", "post_card_dark.share_dark.y"], pct(shareTextY));

  setMulti(m, ["icon_like.y", "post_card_light.icon_like.y", "post_card_dark.icon_like.y"], pct(iconLikeY));
  setMulti(m, ["icon_comment.y", "post_card_light.icon_comment.y", "post_card_dark.icon_comment.y"], pct(iconCommentY));
  setMulti(m, ["icon_share.y", "post_card_light.icon_share.y", "post_card_dark.icon_share.y"], pct(iconShareY));

  // ✅ comment push (X)
  setMulti(m, ["icon_comment.x", "post_card_light.icon_comment.x", "post_card_dark.icon_comment.x"], pct(commentIconX));
  setMulti(m, ["comment_count_light.x", "post_card_light.comment_count_light.x"], pct(commentTextX));
  setMulti(m, ["comment_count_dark.x", "post_card_dark.comment_count_dark.x"], pct(commentTextX));

  // ✅ share stays inside card (anchor right + move to right edge)
  // share_light/share_dark have x_anchor "0%" in your template -> set to "100%" so it grows left.
  setMulti(m, ["share_light.x_anchor", "post_card_light.share_light.x_anchor"], "100%");
  setMulti(m, ["share_dark.x_anchor", "post_card_dark.share_dark.x_anchor"], "100%");

  setMulti(m, ["share_light.x", "post_card_light.share_light.x"], pct(SHARE_RIGHT_X));
  setMulti(m, ["share_dark.x", "post_card_dark.share_dark.x"], pct(SHARE_RIGHT_X));

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
