// api/composite.js (CommonJS, Node 18 on Vercel)
//
// POST /api/composite
// Requires Authorization: Bearer <memberstack token>
//
// Body:
// {
//   mainVideoUrl,
//   backgroundVideoUrl,
//   layout: "sideBySide"|"topBottom",
//   mainSlot: "left"|"right"|"top"|"bottom",
//   mainSpeed: 1|1.25|...,
//   bgSpeed: 1|1.25|...,
//   captions: { enabled: true, style: "karaoke", settings: { x:50, y:82, ... } }
// }
//
// Returns: { ok:true, id:<renderRowId>, composite_status:"compositing" }

const https = require("https");
const crypto = require("crypto");
const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

// -------------------- CORS --------------------
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

  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

// -------------------- Memberstack auth (same as /renders) --------------------
const MEMBERSTACK_SECRET_KEY = process.env.MEMBERSTACK_SECRET_KEY;
const ms = MEMBERSTACK_SECRET_KEY ? memberstackAdmin.init(MEMBERSTACK_SECRET_KEY) : null;

function getBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function isExpiredJwtError(err) {
  const code = err?.code;
  const msg = String(err?.message || "").toLowerCase();
  if (code === "ERR_JWT_EXPIRED") return true;
  if (msg.includes("jwtexpired") || msg.includes("jwt expired")) return true;
  if (msg.includes('"exp"') && msg.includes("failed")) return true;
  if (msg.includes("token_expired")) return true;
  return false;
}

async function requireMemberId(req) {
  const token = getBearerToken(req);
  if (!token) {
    const e = new Error("MISSING_AUTH");
    e.code = "MISSING_AUTH";
    throw e;
  }
  if (!ms) {
    const e = new Error("MISSING_MEMBERSTACK_SECRET_KEY");
    e.code = "MISSING_MEMBERSTACK_SECRET_KEY";
    throw e;
  }

  try {
    const out = await ms.verifyToken({ token });
    const id = out?.id;
    if (!id) {
      const e = new Error("INVALID_MEMBER_TOKEN");
      e.code = "INVALID_MEMBER_TOKEN";
      throw e;
    }
    return String(id);
  } catch (err) {
    if (isExpiredJwtError(err)) {
      const e = new Error("TOKEN_EXPIRED");
      e.code = "TOKEN_EXPIRED";
      throw e;
    }
    throw err;
  }
}

// -------------------- Creatomate --------------------
const CREATOMATE_API_KEY = (process.env.CREATOMATE_API_KEY || "").trim();
const COMPOSITE_TEMPLATE_916 = (process.env.CREATO_COMPOSITE_TEMPLATE_916 || "").trim();

// Element *names* used in your Creatomate template
const MAIN_VIDEO_NAME = (process.env.CREATO_MAIN_VIDEO_NAME || "input_video").trim();
const BG_VIDEO_NAME = (process.env.CREATO_BG_VIDEO_NAME || "bg_video").trim();

const API_BASE = (process.env.API_BASE || "").trim();

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function postJSON(url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(bodyObj);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + (u.search || ""),
        method: "POST",
        headers: {
          Authorization: headers.Authorization,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          let json = {};
          try { json = JSON.parse(buf || "{}"); } catch { json = { raw: buf }; }
          resolve({ status: res.statusCode, json });
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ----- speed steps -----
const SPEED_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function snapSpeed(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 1;
  let best = SPEED_STEPS[0];
  let bestD = Infinity;
  for (const s of SPEED_STEPS) {
    const d = Math.abs(s - n);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function pct(n) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 50;
  n = Math.max(0, Math.min(100, n));
  return `${n}%`;
}

function getSlotRects(layout, mainSlot) {
  const lay = layout === "topBottom" ? "topBottom" : "sideBySide";
  const slot = String(mainSlot || (lay === "topBottom" ? "top" : "left")).toLowerCase();

  if (lay === "topBottom") {
    if (slot === "bottom") {
      return {
        main: { x: 50, y: 75, w: 100, h: 50 },
        bg: { x: 50, y: 25, w: 100, h: 50 },
      };
    }
    return {
      main: { x: 50, y: 25, w: 100, h: 50 },
      bg: { x: 50, y: 75, w: 100, h: 50 },
    };
  }

  if (slot === "right") {
    return {
      main: { x: 75, y: 50, w: 50, h: 100 },
      bg: { x: 25, y: 50, w: 50, h: 100 },
    };
  }
  return {
    main: { x: 25, y: 50, w: 50, h: 100 },
    bg: { x: 75, y: 50, w: 50, h: 100 },
  };
}

function setVideoMods(mods, name, rect, { url, speed, muted }) {
  // position + size (cropped fill happens naturally when slot size differs from aspect)
  mods[`${name}.x_alignment`] = pct(rect.x);
  mods[`${name}.y_alignment`] = pct(rect.y);
  mods[`${name}.width`] = `${rect.w}%`;
  mods[`${name}.height`] = `${rect.h}%`;

  // source
  mods[`${name}.source`] = String(url);

  // speed (Creatomate supports playback_rate on video elements)
  mods[`${name}.playback_rate`] = speed;

  // background muted always
  if (muted) {
    mods[`${name}.volume`] = 0;
    mods[`${name}.muted`] = true;
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }

    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    if (!CREATOMATE_API_KEY) return res.status(500).json({ ok: false, error: "MISSING_CREATOMATE_API_KEY" });
    if (!COMPOSITE_TEMPLATE_916) return res.status(500).json({ ok: false, error: "MISSING_CREATO_COMPOSITE_TEMPLATE_916" });

    const body = typeof req.body === "string" ? safeJsonParse(req.body) || {} : req.body || {};

    const mainVideoUrl = String(body.mainVideoUrl || "").trim();
    const backgroundVideoUrl = String(body.backgroundVideoUrl || "").trim();
    if (!mainVideoUrl) return res.status(400).json({ ok: false, error: "MISSING_MAIN_VIDEO_URL" });
    if (!backgroundVideoUrl) return res.status(400).json({ ok: false, error: "MISSING_BACKGROUND_VIDEO_URL" });

    const layout = body.layout === "topBottom" ? "topBottom" : "sideBySide";
    const mainSlot = String(body.mainSlot || (layout === "topBottom" ? "top" : "left")).trim();

    const mainSpeed = snapSpeed(body.mainSpeed);
    const bgSpeed = snapSpeed(body.bgSpeed);

    const captions = body.captions && typeof body.captions === "object" ? body.captions : {};
    const captionsEnabled = !!captions.enabled;
    const captionStyle = String(captions.style || "sentence").trim();
    const captionSettings = captions.settings && typeof captions.settings === "object" ? captions.settings : {};

    // Create a renders row so it shows up in /myvideos immediately (status compositing)
    const id = crypto.randomUUID();

    const choices = {
      kind: "composite",
      aspectRatio: "9:16",
      mainVideoUrl,
      backgroundVideoUrl,
      layout,
      mainSlot,
      mainSpeed,
      bgSpeed,
      captions: {
        enabled: captionsEnabled,
        style: captionStyle,
        settings: captionSettings,
      },
    };

    const { error: insErr } = await sb.from("renders").insert([
      {
        id,
        member_id,
        // keep these consistent with your existing UI expectations:
        created_at: new Date().toISOString(),
        choices,

        // new composite fields (recommended columns; if you don’t add them, remove these lines)
        composite_status: "compositing",
        composite_error: null,
        composite_video_url: null,
      },
    ]);

    if (insErr) {
      console.error("[COMPOSITE] insert failed", insErr);
      return res.status(500).json({ ok: false, error: "DB_INSERT_FAILED", details: insErr });
    }

    // Build Creatomate modifications (same style as your captions-apply flow)
    const rects = getSlotRects(layout, mainSlot);

    const mods = {};

    // background video element
    setVideoMods(mods, BG_VIDEO_NAME, rects.bg, {
      url: backgroundVideoUrl,
      speed: bgSpeed,
      muted: true,
    });

    // main video element (audio stays on)
    setVideoMods(mods, MAIN_VIDEO_NAME, rects.main, {
      url: mainVideoUrl,
      speed: mainSpeed,
      muted: false,
    });

    // captions visibility:
    // hide all known subtitle layers in this template
    const subtitleNames = [
      "Subtitles_Sentence",
      "Subtitles_Karaoke",
      "Subtitles_Word",
      "Subtitles_BoldWhite",
      "Subtitles_YellowPop",
      "Subtitles_MintTag",
      "Subtitles_Highlighter",
      "Subtitles_PurplePop",
      "Subtitles_OutlinePunch",
      "Subtitles_BlackBar",
      "Subtitles_NeonGlow",
      "Subtitles_CompactLowerThird",
      "Subtitles_BouncePop",
      "Subtitles_RedAlert",
      "Subtitles_RedTag",
    ];

    for (const n of subtitleNames) mods[`${n}.visible`] = false;

    if (captionsEnabled) {
      // Turn on the selected one (match your Creatomate element naming)
      const key = captionStyle.toLowerCase();
      const map = {
        sentence: "Subtitles_Sentence",
        word: "Subtitles_Word",
        boldwhite: "Subtitles_BoldWhite",
        karaoke: "Subtitles_Karaoke",
        yellowpop: "Subtitles_YellowPop",
        minttag: "Subtitles_MintTag",
        highlighter: "Subtitles_Highlighter",
        purplepop: "Subtitles_PurplePop",
        outlinepunch: "Subtitles_OutlinePunch",
        blackbar: "Subtitles_BlackBar",
        neonglow: "Subtitles_NeonGlow",
        compactlowerthird: "Subtitles_CompactLowerThird",
        bouncepop: "Subtitles_BouncePop",
        redalert: "Subtitles_RedAlert",
        redtag: "Subtitles_RedTag",
      };

      const chosen = map[key] || "Subtitles_Sentence";
      mods[`${chosen}.visible`] = true;

      // pass through caption position from your UI (x/y in numbers -> percent)
      if (captionSettings.x != null) mods[`${chosen}.x_alignment`] = pct(captionSettings.x);
      if (captionSettings.y != null) mods[`${chosen}.y_alignment`] = pct(captionSettings.y);

      // If you want to also pass font/size/colors here, we can,
      // but since your template already has the looks baked in, it’s optional.
      // (Your existing captions UI sends a lot—add them when you’re ready.)
    }

    const publicBaseUrl = API_BASE || `https://${req.headers.host}`;
    const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(id)}&kind=composite`;

    const payload = {
      template_id: COMPOSITE_TEMPLATE_916,
      modifications: mods,
      output_format: "mp4",
      webhook_url,
    };

    const resp = await postJSON(
      "https://api.creatomate.com/v1/renders",
      { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
      payload
    );

    if (resp.status !== 202 && resp.status !== 200) {
      await sb.from("renders").update({
        composite_status: "failed",
        composite_error: JSON.stringify(resp.json),
      }).eq("id", id).eq("member_id", member_id);

      return res.status(resp.status).json({ ok: false, error: "CREATOMATE_ERROR", details: resp.json });
    }

    const composite_job_id = Array.isArray(resp.json) ? resp.json[0]?.id : resp.json?.id;

    await sb.from("renders").update({
      composite_job_id: composite_job_id || null,
      composite_status: "compositing",
    }).eq("id", id).eq("member_id", member_id);

    return res.status(200).json({
      ok: true,
      id,
      composite_status: "compositing",
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = err?.code;

    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) {
      return res.status(401).json({ ok: false, error: "TOKEN_EXPIRED", message: "Session expired. Refresh the page and try again." });
    }
    if (code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) {
      return res.status(401).json({ ok: false, error: "MISSING_AUTH" });
    }
    if (code === "INVALID_MEMBER_TOKEN" || msg.includes("INVALID_MEMBER")) {
      return res.status(401).json({ ok: false, error: "INVALID_MEMBER_TOKEN" });
    }
    if (code === "MISSING_MEMBERSTACK_SECRET_KEY") {
      return res.status(500).json({ ok: false, error: "MISSING_MEMBERSTACK_SECRET_KEY" });
    }

    console.error("[COMPOSITE] SERVER_ERROR", err);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR", message: msg });
  }
};
