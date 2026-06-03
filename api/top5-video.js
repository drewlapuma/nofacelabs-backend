// api/top5-video.js (CommonJS, Node 18+)
// ✅ Top 5 / Top 2-9 Video Generator render endpoint
// ✅ Uses Creatomate template modifications
// ✅ Writes to Supabase "renders" so it appears in /my-videos
// ✅ Auth via Authorization Bearer OR x-nf-member-id fallback
//
// IMPORTANT:
// This endpoint expects PUBLIC https video URLs, not blob: URLs.
// Your frontend must upload each selected file to Supabase/R2 first, then send those URLs here.
//
// Expected Creatomate template layer names:
// Title
// Music
// For ranks 1-9:
// Clip1_Background, Clip1_Foreground, Rank1
// Clip2_Background, Clip2_Foreground, Rank2
// ...
// Clip9_Background, Clip9_Foreground, Rank9
//
// Recommended template canvas: 1080x1920 vertical.

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;

const TEMPLATE_ID =
  process.env.CREATOMATE_TEMPLATE_ID_TOP5_VIDEO ||
  process.env.CREATOMATE_TEMPLATE_ID_TOP5 ||
  "";

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

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-NF-Member-Id, x-nf-member-id"
  );
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  let data = "";
  for await (const chunk of req) data += chunk;
  if (!data.trim()) return {};

  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// -------------------- Memberstack auth --------------------
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

async function getMemberId(req) {
  const token = getBearerToken(req);

  if (token) {
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

  const headerId =
    req.headers["x-nf-member-id"] ||
    req.headers["X-NF-Member-Id"] ||
    req.headers["x-nf-member-id".toLowerCase()];

  if (headerId) return String(headerId);

  const e = new Error("MISSING_AUTH");
  e.code = "MISSING_AUTH";
  throw e;
}

// -------------------- Creatomate --------------------
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

// -------------------- utils --------------------
function safeStr(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function clampNum(n, min, max, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function ensurePublicHttpUrl(url, label) {
  const u = String(url || "").trim();

  if (!u) return "";
  if (u.startsWith("blob:")) throw new Error(`${label} is a blob: URL. Upload it first and send a public https URL.`);
  if (u.startsWith("data:")) throw new Error(`${label} is a data: URL. Upload it first and send a public https URL.`);
  if (!/^https?:\/\//i.test(u)) throw new Error(`${label} must be an http(s) URL.`);

  return u;
}

function pctFromPreviewX(x) {
  const n = clampNum(x, 0, 360, 0);
  return `${Number(((n / 360) * 100).toFixed(3))}%`;
}

function pctFromPreviewY(y) {
  const n = clampNum(y, 0, 640, 0);
  return `${Number(((n / 640) * 100).toFixed(3))}%`;
}

function scaleFontFromPreview(pxValue) {
  return Math.round(clampNum(pxValue, 8, 140, 40) * 3);
}

function safeDuration(v, fallback = 4) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clampNum(n, 0.25, 300, fallback);
}

function normalizeFont(font) {
  const f = safeStr(font, "Luckiest Guy");
  const allowed = new Set([
    "Luckiest Guy",
    "Bangers",
    "Titan One",
    "Anton",
    "Inter",
    "Poppins",
    "Staatliches",
    "Sigmar One",
  ]);

  return allowed.has(f) ? f : "Luckiest Guy";
}

function normalizeHex(v, fallback) {
  const s = String(v || "").trim();

  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s;

  return fallback;
}

function hideLayer(m, name) {
  m[`${name}.hidden`] = true;
  m[`${name}.opacity`] = "0%";
  m[`${name}.visible`] = false;
  m[`${name}.enabled`] = false;
  m[`${name}.time`] = 0;
  m[`${name}.duration`] = 0.01;
}

function showLayer(m, name) {
  m[`${name}.hidden`] = false;
  m[`${name}.opacity`] = "100%";
  m[`${name}.visible`] = true;
  m[`${name}.enabled`] = true;
}

function sumDurations(items) {
  return items.reduce((sum, item) => sum + safeDuration(item.duration, 4), 0);
}

// -------------------- Top 5 modifications --------------------
function normalizeItems(body) {
  const rankCount = clampNum(body.rankCount, 2, 9, 5);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const items = rawItems
    .slice(0, rankCount)
    .map((it, index) => {
      const rank = clampNum(it?.rank ?? index + 1, 1, rankCount, index + 1);
      const videoUrl = ensurePublicHttpUrl(it?.videoUrl || it?.url || it?.source || "", `items[${index}].videoUrl`);
      const label = safeStr(it?.label || it?.text || `Rank ${rank}`);
      const duration = safeDuration(it?.duration || it?.durationSec || it?.clipDuration, 4);

      return {
        rank,
        index,
        videoUrl,
        label,
        duration,
        fileName: safeStr(it?.fileName || it?.name || ""),
      };
    })
    .filter((it) => it.videoUrl);

  if (!items.length) throw new Error("Missing items. Send at least one ranked videoUrl.");

  return { rankCount, items };
}

function buildModifications(body) {
  const { rankCount, items } = normalizeItems(body);
  const totalDuration = Math.max(0.5, sumDurations(items));

  const title = body.title && typeof body.title === "object" ? body.title : {};
  const ranksStyle = body.ranks && typeof body.ranks === "object" ? body.ranks : {};
  const layout = body.layout && typeof body.layout === "object" ? body.layout : {};
  const music = body.music && typeof body.music === "object" ? body.music : {};

  const titleText = safeStr(title.text, "TOP 5 BEST\nMOMENTS");
  const titleFont = normalizeFont(title.font || title.fontFamily || "Luckiest Guy");
  const titleSize = scaleFontFromPreview(title.size ?? title.fontSize ?? 27);
  const titleColor = normalizeHex(title.color || title.fillColor, "#ffffff");
  const titleY = pctFromPreviewY(title.y ?? 21);

  const rankFont = normalizeFont(ranksStyle.font || ranksStyle.fontFamily || "Luckiest Guy");
  const rankNumSize = scaleFontFromPreview(ranksStyle.numberSize ?? ranksStyle.numSize ?? 18);
  const rankLabelSize = scaleFontFromPreview(ranksStyle.labelSize ?? 18);
  const rankX = pctFromPreviewX(ranksStyle.x ?? 20);
  const lineSpacingPx = clampNum(ranksStyle.spacing ?? ranksStyle.lineSpacing, 10, 160, 30);
  const labelOffsetPx = clampNum(ranksStyle.labelOffset ?? 40, 0, 200, 40);
  const colors = Array.isArray(ranksStyle.colors) ? ranksStyle.colors : [];

  const modeRaw = safeStr(layout.mode || "blurred").toLowerCase();
  const isFullMode = modeRaw === "full" || modeRaw === "full-background" || modeRaw === "full_background";

  const foreX = pctFromPreviewX(layout.foregroundX ?? layout.foreX ?? 75);
  const foreY = pctFromPreviewY(layout.foregroundY ?? layout.foreY ?? 230);
  const foreScale = clampNum(layout.foregroundScale ?? layout.foreScale ?? 0.75, 0.1, 2, 0.75);
  const blurAmount = clampNum(layout.blurAmount ?? layout.blur ?? 12, 0, 40, 12);

  const musicEnabled =
    music.enabled === true ||
    String(music.enabled || "").toLowerCase() === "true" ||
    String(music.enabled || "") === "1";

  const musicUrl = musicEnabled ? ensurePublicHttpUrl(music.url || music.musicUrl || music.source || "", "music.url") : "";
  const musicVolume = clampNum(music.volume ?? 0.35, 0, 1.5, 0.35);

  const m = {};

  for (let i = 1; i <= 9; i++) {
    hideLayer(m, `Clip${i}_Background`);
    hideLayer(m, `Clip${i}_Foreground`);
    hideLayer(m, `Rank${i}`);
  }

  hideLayer(m, "Music");

  showLayer(m, "Title");
  m["Title.text"] = titleText;
  m["Title.font_family"] = titleFont;
  m["Title.font_size"] = titleSize;
  m["Title.fill_color"] = titleColor;
  m["Title.x"] = "50%";
  m["Title.y"] = titleY;
  m["Title.time"] = 0;
  m["Title.duration"] = totalDuration;
  m["Title.text_align"] = "center";

  let cursor = 0;

  items.forEach((item, index) => {
    const n = index + 1;
    const clipDur = safeDuration(item.duration, 4);
    const rankColor = normalizeHex(
      colors[index],
      ["#ff2d7a", "#ff9500", "#eaff00", "#00ff3b", "#00f5ff", "#a855f7", "#ffffff", "#5ac1ff", "#ff3b30"][index] || "#ffffff"
    );

    const bgName = `Clip${n}_Background`;
    const fgName = `Clip${n}_Foreground`;
    const rankName = `Rank${n}`;

    showLayer(m, bgName);
    m[`${bgName}.source`] = item.videoUrl;
    m[`${bgName}.time`] = cursor;
    m[`${bgName}.duration`] = clipDur;
    m[`${bgName}.fit`] = "cover";
    m[`${bgName}.volume`] = "100%";

    if (isFullMode) {
      m[`${bgName}.x`] = "50%";
      m[`${bgName}.y`] = "50%";
      m[`${bgName}.width`] = "100%";
      m[`${bgName}.height`] = "100%";
      m[`${bgName}.blur`] = 0;
      m[`${bgName}.opacity`] = "100%";

      hideLayer(m, fgName);
    } else {
      m[`${bgName}.x`] = "50%";
      m[`${bgName}.y`] = "50%";
      m[`${bgName}.width`] = "112%";
      m[`${bgName}.height`] = "112%";
      m[`${bgName}.blur`] = blurAmount;
      m[`${bgName}.opacity`] = "100%";

      showLayer(m, fgName);
      m[`${fgName}.source`] = item.videoUrl;
      m[`${fgName}.time`] = cursor;
      m[`${fgName}.duration`] = clipDur;
      m[`${fgName}.fit`] = "cover";
      m[`${fgName}.x`] = foreX;
      m[`${fgName}.y`] = foreY;
      m[`${fgName}.width`] = `${Math.round(62.5 * foreScale * 1000) / 1000}%`;
      m[`${fgName}.height`] = `${Math.round(111.111 * foreScale * 1000) / 1000}%`;
      m[`${fgName}.volume`] = "100%";
    }

    showLayer(m, rankName);
    m[`${rankName}.text`] = `${n}. ${item.label}`;
    m[`${rankName}.time`] = cursor;
    m[`${rankName}.duration`] = Math.max(0.1, totalDuration - cursor);
    m[`${rankName}.font_family`] = rankFont;
    m[`${rankName}.font_size`] = rankLabelSize;
    m[`${rankName}.fill_color`] = rankColor;
    m[`${rankName}.x`] = rankX;
    m[`${rankName}.y`] = pctFromPreviewY((ranksStyle.y ?? 80) + index * lineSpacingPx);
    m[`${rankName}.text_align`] = "left";
    m[`${rankName}.stroke_color`] = "#000000";
    m[`${rankName}.stroke_width`] = Math.max(1, Math.round(rankLabelSize * 0.08));
    m[`${rankName}.shadow_color`] = "#000000";
    m[`${rankName}.shadow_blur`] = 0;
    m[`${rankName}.shadow_distance`] = Math.max(2, Math.round(rankLabelSize * 0.09));
    m[`${rankName}.number_font_size`] = rankNumSize;
    m[`${rankName}.label_font_size`] = rankLabelSize;
    m[`${rankName}.label_offset`] = labelOffsetPx;

    cursor += clipDur;
  });

  if (musicEnabled && musicUrl) {
    showLayer(m, "Music");
    m["Music.source"] = musicUrl;
    m["Music.time"] = 0;
    m["Music.duration"] = totalDuration;
    m["Music.volume"] = `${Math.round(musicVolume * 100)}%`;
    m["Music.loop"] = true;
  }

  return {
    modifications: m,
    rankCount,
    totalDuration,
    items,
    choices: {
      kind: "top5_video",
      rankCount,
      totalDuration,
      title: {
        text: titleText,
        font: titleFont,
        size: title.size ?? title.fontSize ?? 27,
        color: titleColor,
        y: title.y ?? 21,
      },
      ranks: {
        font: rankFont,
        numberSize: ranksStyle.numberSize ?? ranksStyle.numSize ?? 18,
        labelSize: ranksStyle.labelSize ?? 18,
        x: ranksStyle.x ?? 20,
        y: ranksStyle.y ?? 80,
        spacing: lineSpacingPx,
        labelOffset: labelOffsetPx,
        colors,
      },
      layout: {
        mode: isFullMode ? "full" : "blurred",
        foregroundX: layout.foregroundX ?? layout.foreX ?? 75,
        foregroundY: layout.foregroundY ?? layout.foreY ?? 230,
        foregroundScale: foreScale,
        blurAmount,
      },
      music: {
        enabled: musicEnabled,
        url: musicUrl,
        volume: musicVolume,
      },
      items: items.map((it) => ({
        rank: it.rank,
        label: it.label,
        videoUrl: it.videoUrl,
        duration: it.duration,
        fileName: it.fileName,
      })),
    },
  };
}

// -------------------- MAIN handler --------------------
module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    if (!TEMPLATE_ID) {
      return json(res, 500, {
        ok: false,
        error: "Missing CREATOMATE_TEMPLATE_ID_TOP5_VIDEO",
      });
    }

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
      });
    }

    if (req.method !== "POST") {
      return json(res, 405, {
        ok: false,
        error: "Use POST or GET",
      });
    }

    const body = await readBody(req);

    const member_id = await getMemberId(req);
    const sb = getAdminSupabase();

    const built = buildModifications(body);
    const { modifications, choices } = built;

    const firstLabel = choices.items?.find((x) => x?.label)?.label || "";
    const video_name =
      safeStr(body.video_name || body.videoName || "").trim() ||
      safeStr(body.title?.text || "").replace(/\s+/g, " ").slice(0, 60) ||
      firstLabel ||
      `Top ${choices.rankCount} video`;

    const { data: inserted, error: insErr } = await sb
      .from("renders")
      .insert({
        member_id,
        status: "rendering",
        render_id: null,
        video_url: null,
        error: null,
        kind: "top5_video",
        video_name,
        choices,
      })
      .select("*")
      .single();

    if (insErr || !inserted?.id) {
      console.error("[top5-video] renders insert failed", insErr);
      return json(res, 500, {
        ok: false,
        error: "RENDERS_INSERT_FAILED",
        details: insErr,
      });
    }

    const dbId = inserted.id;

    const publicBaseUrl = (process.env.API_BASE || "").trim() || `https://${req.headers.host}`;
    const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(dbId)}&kind=main`;

    const startResp = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,
      modifications,
      output_format: "mp4",
      render_scale: 1,
      webhook_url,
    });

    const start = Array.isArray(startResp) ? startResp[0] : startResp;
    const renderId = start?.id;

    if (!renderId) {
      await sb
        .from("renders")
        .update({
          status: "failed",
          error: JSON.stringify({ error: "NO_RENDER_ID", startResp }),
        })
        .eq("id", dbId);

      return json(res, 502, {
        ok: false,
        error: "Creatomate did not return render id",
        raw: startResp,
      });
    }

    await sb
      .from("renders")
      .update({
        render_id: renderId,
        status: "rendering",
        error: null,
      })
      .eq("id", dbId);

    return json(res, 200, {
      ok: true,
      id: dbId,
      renderId,
      status: start?.status || "queued",
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = err?.code;

    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) {
      return json(res, 401, {
        ok: false,
        error: "TOKEN_EXPIRED",
        message: "Session expired. Refresh and try again.",
      });
    }

    if (code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) {
      return json(res, 401, { ok: false, error: "MISSING_AUTH" });
    }

    if (code === "INVALID_MEMBER_TOKEN" || msg.includes("INVALID_MEMBER")) {
      return json(res, 401, { ok: false, error: "INVALID_MEMBER_TOKEN" });
    }

    if (code === "MISSING_MEMBERSTACK_SECRET_KEY") {
      return json(res, 500, { ok: false, error: "MISSING_MEMBERSTACK_SECRET_KEY" });
    }

    console.error("[top5-video] SERVER_ERROR", err);

    return json(res, 500, {
      ok: false,
      error: "SERVER_ERROR",
      message: msg,
    });
  }
};
