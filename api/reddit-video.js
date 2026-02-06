// api/reddit-video.js (CommonJS, Node 18+)
// POST starts a Creatomate render
// GET polls status
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

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ------------------------------
// BASE VALUES from YOUR template
// ------------------------------
// post_bg_light inspector:
// y: 24.2746%
// height: 18%
const BASE_BG_Y = 24.2746;
const BASE_BG_H = 18.0;

// Footer Y values (from your element JSON paste)
const BASE_SHARE_Y = 30.5096;     // share_light
const BASE_COUNTS_Y = 30.3637;    // like_count_light / comment_count_light
const BASE_ICONS_Y = 31.66;       // icon_share / icon_comment
const BASE_ICON_LIKE_Y = 31.6571; // icon_like

// Wrapping heuristic → how much to grow bg height
const WRAP_CHARS_PER_LINE = 34;  // tune if needed
const LINES_FREE = 3;            // no growth up to this many lines
const PER_EXTRA_LINE_H = 3.15;   // % height added per extra line
const MAX_EXTRA_H = 22;          // cap

function estimateLines(text) {
  const t = safeStr(text, "—");
  const hardLines = t.split("\n");
  let total = 0;

  for (const ln of hardLines) {
    const s = (ln || "").trim();
    if (!s) {
      total += 1;
      continue;
    }
    total += Math.max(1, Math.ceil(s.length / WRAP_CHARS_PER_LINE));
  }
  return clamp(total, 1, 20);
}

function buildModifications(body) {
  const username = safeStr(body.username, "Nofacelabs.ai");
  const postText = safeStr(body.postText || body.postTitle, "—");
  const likes = safeStr(body.likes, "99+");
  const comments = safeStr(body.comments, "99+");
  const shareText = safeStr(body.shareText, "share");
  const pfpUrl = safeStr(body.pfpUrl, "");
  const bgUrl = safeStr(body.backgroundVideoUrl, "");

  // grow logic
  const lines = estimateLines(postText);
  const extraLines = Math.max(0, lines - LINES_FREE);
  const deltaH = clamp(extraLines * PER_EXTRA_LINE_H, 0, MAX_EXTRA_H);

  const newBgH = BASE_BG_H + deltaH;

  // center-anchored shape: to keep TOP pinned, move center down by deltaH/2
  const newBgY = clamp(BASE_BG_Y + (deltaH / 2), 0, 100);

  // bottom edge moves down by deltaH/2, so footer shift = deltaH/2
  const footerShift = deltaH / 2;

  const m = {};

  // ✅ HARD FORCE: card groups ALWAYS visible (prevents “disappeared”)
  m["post_card_light.hidden"] = false;
  m["post_card_light.opacity"] = 1;

  m["post_card_dark.hidden"] = false;
  m["post_card_dark.opacity"] = 1;

  // Background shapes: always visible too (we’re debugging stability first)
  m["post_bg_light.hidden"] = false;
  m["post_bg_light.opacity"] = 1;
  m["post_bg_light.height"] = `${newBgH}%`;
  m["post_bg_light.y"] = `${newBgY}%`;

  m["post_bg_dark.hidden"] = false;
  m["post_bg_dark.opacity"] = 1;
  m["post_bg_dark.height"] = `${newBgH}%`;
  m["post_bg_dark.y"] = `${newBgY}%`;

  // Text (ONLY your real names)
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

  // PFP
  if (pfpUrl) {
    m["pfp_light.source"] = pfpUrl;
    m["pfp_dark.source"] = pfpUrl;
  }

  // Video
  if (bgUrl) {
    m["Video.source"] = bgUrl;
  }

  // Footer follow
  const yCounts = clamp(BASE_COUNTS_Y + footerShift, 0, 100);
  const yShare = clamp(BASE_SHARE_Y + footerShift, 0, 100);
  const yIcons = clamp(BASE_ICONS_Y + footerShift, 0, 100);
  const yLikeIcon = clamp(BASE_ICON_LIKE_Y + footerShift, 0, 100);

  m["like_count_light.y"] = `${yCounts}%`;
  m["comment_count_light.y"] = `${yCounts}%`;
  m["like_count_dark.y"] = `${yCounts}%`;
  m["comment_count_dark.y"] = `${yCounts}%`;

  m["share_light.y"] = `${yShare}%`;
  m["share_dark.y"] = `${yShare}%`;

  // Icons (same names in both cards)
  m["icon_share.y"] = `${yIcons}%`;
  m["icon_comment.y"] = `${yIcons}%`;
  m["icon_like.y"] = `${yLikeIcon}%`;

  return m;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.end();

  try {
    if (!TEMPLATE_ID) {
      return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_REDDIT" });
    }

    // GET: poll
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });

      const r = await creatomateRequest(`/v1/renders/${encodeURIComponent(id)}`, "GET");
      const status = String(r?.status || "").toLowerCase();
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";

      return json(res, 200, { ok: true, status, url: finalUrl || null });
    }

    // POST: start render
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
