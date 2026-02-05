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

/* -----------------------------
   AUTO-GROW SETTINGS
-------------------------------- */

// Your comp is 720x1280 (from renders)
const COMP_H_PX = 1280;

// ✅ SET THIS: what is post_bg_light height (in %) when title is 1 line?
// In Creatomate, click "post_bg_light" and copy the height percent.
// Example placeholder:
const BASE_BG_HEIGHT_PCT = 18;

// How much “extra height” per additional wrapped line (in px -> converted to %)
const FONT_SIZE_PX = 34;     // approx
const LINE_HEIGHT_PX = 40;   // approx
const MAX_LINES = 6;

// Rough wrap estimate
const CARD_TEXT_MAX_WIDTH_PX = 520;

function estimateLineCount(text) {
  const t = String(text || "").trim();
  if (!t) return 1;

  const avgChar = FONT_SIZE_PX * 0.56;
  const approxCharsPerLine = Math.max(8, Math.floor(CARD_TEXT_MAX_WIDTH_PX / avgChar));

  const parts = t.split("\n").map((line) => {
    const len = line.trim().length || 1;
    return Math.ceil(len / approxCharsPerLine);
  });

  const total = parts.reduce((a, b) => a + b, 0);
  return Math.max(1, Math.min(MAX_LINES, total));
}

function pxToPctY(px) {
  return (px / COMP_H_PX) * 100;
}

function pctStr(n) {
  return `${Number(n).toFixed(4)}%`;
}

function parsePct(v) {
  if (typeof v === "number") return v;
  const s = String(v || "").trim();
  const m = s.match(/^(-?\d+(\.\d+)?)%$/);
  if (!m) return NaN;
  return Number(m[1]);
}

function bumpYPercent(mods, layerName, baselineYPct, deltaPct) {
  const base = Number(baselineYPct);
  if (!Number.isFinite(base)) return;
  mods[`${layerName}.y`] = pctStr(base + deltaPct);
}

/**
 * Your footer baseline Y% (LIGHT) from what you pasted:
 * share_light y: 30.5096%
 * icon_share y: 31.66%
 * icon_comment y: 31.66%
 * icon_like y: 31.6571%
 * comment_count_light y: 30.3637%
 * like_count_light y: 30.3637%
 *
 * If DARK differs, replace the dark baselines below.
 */
const FOOTER_BASE_Y_PCT = {
  // shared icons
  icon_like: 31.6571,
  icon_comment: 31.66,
  icon_share: 31.66,

  // light
  like_count_light: 30.3637,
  comment_count_light: 30.3637,
  share_light: 30.5096,

  // dark (assume same until you paste dark values)
  like_count_dark: 30.3637,
  comment_count_dark: 30.3637,
  share_dark: 30.5096,
};

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

  const m = {};

  // --- show/hide cards + backgrounds ---
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? 1 : 0;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? 1 : 0;

  m["post_bg_light.hidden"] = !showLight;
  m["post_bg_light.opacity"] = showLight ? 1 : 0;

  m["post_bg_dark.hidden"] = !showDark;
  m["post_bg_dark.opacity"] = showDark ? 1 : 0;

  // --- text ---
  m["username_light.text"] = username;
  m["username_dark.text"] = username;

  m["post_text_light.text"] = postText;
  m["post_text_dark.text"] = postText;

  m["like_count_light.text"] = likes;
  m["like_count_dark.text"] = likes;

  m["comment_count_light.text"] = comments;
  m["comment_count_dark.text"] = comments;

  m["share_light.text"] = shareText;
  m["share_dark.text"] = shareText;

  // --- images ---
  if (pfpUrl) {
    m["pfp_light.source"] = pfpUrl;
    m["pfp_dark.source"] = pfpUrl;
  }

  // --- video ---
  if (bgUrl) {
    m["Video.source"] = bgUrl;
  }

  // --- auto-grow background + push footer down (ALL IN %) ---
  const lines = estimateLineCount(postText);
  const extraLines = Math.max(0, lines - 1);

  const growPx = extraLines * LINE_HEIGHT_PX;
  const growPct = pxToPctY(growPx);

  // grow the card background height
  const newBgHeight = BASE_BG_HEIGHT_PCT + growPct;
  m["post_bg_light.height"] = pctStr(newBgHeight);
  m["post_bg_dark.height"] = pctStr(newBgHeight);

  // push footer items down by the same percent
  bumpYPercent(m, "icon_like", FOOTER_BASE_Y_PCT.icon_like, growPct);
  bumpYPercent(m, "icon_comment", FOOTER_BASE_Y_PCT.icon_comment, growPct);
  bumpYPercent(m, "icon_share", FOOTER_BASE_Y_PCT.icon_share, growPct);

  bumpYPercent(m, "like_count_light", FOOTER_BASE_Y_PCT.like_count_light, growPct);
  bumpYPercent(m, "comment_count_light", FOOTER_BASE_Y_PCT.comment_count_light, growPct);
  bumpYPercent(m, "share_light", FOOTER_BASE_Y_PCT.share_light, growPct);

  bumpYPercent(m, "like_count_dark", FOOTER_BASE_Y_PCT.like_count_dark, growPct);
  bumpYPercent(m, "comment_count_dark", FOOTER_BASE_Y_PCT.comment_count_dark, growPct);
  bumpYPercent(m, "share_dark", FOOTER_BASE_Y_PCT.share_dark, growPct);

  // debug
  m["_debug.lines"] = lines;
  m["_debug.growPct"] = growPct;

  return m;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();

  try {
    if (!TEMPLATE_ID) {
      return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_REDDIT" });
    }

    // GET poll
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest(`/v1/renders/${encodeURIComponent(id)}`, "GET");
      const status = String(r?.status || "").toLowerCase();
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";

      return json(res, 200, { ok: true, status, url: finalUrl || null });
    }

    // POST start render
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
