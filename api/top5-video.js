// api/top5-video.js (CommonJS, Node 18+)
// ✅ Fixes Title/Rank offset by using top-left coordinates
// ✅ Attempts to fix black tail with top-level duration + Main.duration/Composition.duration
// ✅ Uses new Creatomate layers: Clip#_BlurBackground, Clip#_FullBackground, Clip#_Foreground, Rank#

const https = require("https");
const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const TEMPLATE_ID =
  process.env.CREATOMATE_TEMPLATE_ID_TOP5_VIDEO ||
  process.env.CREATOMATE_TEMPLATE_ID_TOP5 ||
  "";

const PREVIEW_W = 320;
const PREVIEW_H = PREVIEW_W * 16 / 9;

const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || process.env.ALLOW_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOW_ORIGINS.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && ALLOW_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-NF-Member-Id, x-nf-member-id");
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
  try { return JSON.parse(data); } catch { return {}; }
}

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
  return code === "ERR_JWT_EXPIRED" || msg.includes("jwtexpired") || msg.includes("jwt expired") || (msg.includes('"exp"') && msg.includes("failed")) || msg.includes("token_expired");
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

  const headerId = req.headers["x-nf-member-id"] || req.headers["X-NF-Member-Id"] || req.headers["x-nf-member-id".toLowerCase()];
  if (headerId) return String(headerId);

  const e = new Error("MISSING_AUTH");
  e.code = "MISSING_AUTH";
  throw e;
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
          try { j = JSON.parse(out || "{}"); } catch { j = { raw: out }; }
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(j);
          console.error("[top5-video] Creatomate error response", { statusCode: res.statusCode, response: j, requestPayload: payload });
          const err = new Error(`Creatomate HTTP ${res.statusCode}: ${JSON.stringify(j).slice(0, 1800)}`);
          err.statusCode = res.statusCode;
          err.creatomateResponse = j;
          reject(err);
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
function pct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0%";
  return `${Number(x.toFixed(3))}%`;
}
function pctFromPreviewX(x) {
  const n = clampNum(x, -PREVIEW_W, PREVIEW_W * 2, 0);
  return pct((n / PREVIEW_W) * 100);
}
function pctFromPreviewY(y) {
  const n = clampNum(y, -PREVIEW_H, PREVIEW_H * 2, 0);
  return pct((n / PREVIEW_H) * 100);
}
function scaleFontFromPreview(pxValue) {
  const n = clampNum(pxValue, 8, 140, 40);
  return Math.round(n * (720 / PREVIEW_W));
}
function safeDuration(v, fallback = 4) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clampNum(n, 0.25, 300, fallback);
}
function normalizeFont(font) {
  const f = safeStr(font, "Luckiest Guy");
  const allowed = new Set(["Luckiest Guy", "Bangers", "Titan One", "Anton", "Inter", "Poppins", "Staatliches", "Sigmar One"]);
  return allowed.has(f) ? f : "Luckiest Guy";
}
function normalizeHex(v, fallback) {
  const s = String(v || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return s;
  return fallback;
}
function removeExt(name) { return String(name || "").replace(/\.[a-z0-9]{2,8}$/i, ""); }
function cleanLabel(raw, rank) {
  let label = safeStr(raw, "");
  label = removeExt(label).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const looksLikeUuid = /[a-f0-9]{8}\s+[a-f0-9]{4}\s+[a-f0-9]{4}/i.test(label) || /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i.test(label) || /^[a-f0-9\s-]{24,}$/i.test(label);
  if (!label || looksLikeUuid || label.length > 32) return `Clip ${rank}`;
  return label.slice(0, 32);
}
function hideLayer(m, name) {
  m[`${name}.hidden`] = true;
  m[`${name}.opacity`] = "0%";
  m[`${name}.time`] = 0;
  m[`${name}.duration`] = 0.01;
}
function showLayer(m, name) {
  m[`${name}.hidden`] = false;
  m[`${name}.opacity`] = "100%";
}
function sumDurations(items) { return items.reduce((sum, item) => sum + safeDuration(item.duration, 4), 0); }

function normalizeItems(body) {
  const rankCount = clampNum(body.rankCount, 2, 9, 5);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.slice(0, rankCount).map((it, index) => {
    const rank = clampNum(it?.rank ?? index + 1, 1, rankCount, index + 1);
    const videoUrl = ensurePublicHttpUrl(it?.videoUrl || it?.url || it?.source || "", `items[${index}].videoUrl`);
    const rawLabel = it?.label || it?.text || it?.displayName || "";
    const fileName = safeStr(it?.fileName || it?.name || "");
    const label = cleanLabel(rawLabel || fileName || `Clip ${rank}`, rank);
    const duration = safeDuration(it?.duration || it?.durationSec || it?.clipDuration, 4);
    return { rank, index, videoUrl, label, duration, fileName };
  }).filter((it) => it.videoUrl);
  if (!items.length) throw new Error("Missing items. Send at least one ranked videoUrl.");
  return { rankCount, items };
}

function buildModifications(body) {
  const { rankCount, items } = normalizeItems(body);
  const totalDurationRaw = Math.max(0.5, sumDurations(items));
  const totalDuration = Math.round(totalDurationRaw * 1000) / 1000;

  const title = body.title && typeof body.title === "object" ? body.title : {};
  const ranksStyle = body.ranks && typeof body.ranks === "object" ? body.ranks : {};
  const layout = body.layout && typeof body.layout === "object" ? body.layout : {};
  const music = body.music && typeof body.music === "object" ? body.music : {};

  const titleText = safeStr(title.text, "TOP 5 BEST\nMOMENTS");
  const titleFont = normalizeFont(title.font || title.fontFamily || "Luckiest Guy");
  const titlePreviewSize = clampNum(title.size ?? title.fontSize, 8, 140, 27);
  const titleSize = scaleFontFromPreview(titlePreviewSize);
  const titleColor = normalizeHex(title.color || title.fillColor, "#ffffff");
  const titleTopPx = clampNum(title.y ?? 21, 0, PREVIEW_H, 21);

  const rankFont = normalizeFont(ranksStyle.font || ranksStyle.fontFamily || "Luckiest Guy");
  const rankPreviewSize = clampNum(ranksStyle.labelSize ?? ranksStyle.numberSize, 8, 100, 18);
  const rankLabelSize = scaleFontFromPreview(rankPreviewSize);
  const rankLeftPx = clampNum(ranksStyle.x ?? 20, 0, PREVIEW_W, 20);
  const rankTopPx = Number(ranksStyle.y ?? 80);
  const lineSpacingPx = clampNum(ranksStyle.spacing ?? ranksStyle.lineSpacing, 10, 160, 30);
  const colors = Array.isArray(ranksStyle.colors) ? ranksStyle.colors : [];

  const modeRaw = safeStr(layout.mode || "blurred").toLowerCase();
  const isFullMode = modeRaw === "full" || modeRaw === "full-background" || modeRaw === "full_background";

  const foreLeftPx = clampNum(layout.foregroundX ?? layout.foreX ?? 75, -PREVIEW_W, PREVIEW_W, 75);
  const foreTopPx = clampNum(layout.foregroundY ?? layout.foreY ?? 230, -PREVIEW_H, PREVIEW_H, 230);
  const foreScale = clampNum(layout.foregroundScale ?? layout.foreScale ?? 0.75, 0.1, 2, 0.75);
  const forePreviewW = 240 * foreScale;
  const forePreviewH = forePreviewW * 16 / 9;
  const foreCenterX = foreLeftPx + forePreviewW / 2;
  const foreCenterY = foreTopPx + forePreviewH / 2;
  const foreSizePct = Math.round(((forePreviewW / PREVIEW_W) * 100) * 1000) / 1000;

  const musicEnabled = music.enabled === true || String(music.enabled || "").toLowerCase() === "true" || String(music.enabled || "") === "1";
  const musicUrl = musicEnabled ? ensurePublicHttpUrl(music.url || music.musicUrl || music.source || "", "music.url") : "";
  const musicVolume = clampNum(music.volume ?? 0.35, 0, 1.5, 0.35);

  const m = {};

  // Helps if your top-level composition is named Main or Composition.
  // If this causes a 400, delete these two lines and set the base template duration to 1 second in Creatomate.
  m["Main.duration"] = totalDuration;
  m["Composition.duration"] = totalDuration;

  for (let i = 1; i <= 9; i++) {
    hideLayer(m, `Clip${i}_BlurBackground`);
    hideLayer(m, `Clip${i}_FullBackground`);
    hideLayer(m, `Clip${i}_Foreground`);
    hideLayer(m, `Rank${i}`);
  }
  hideLayer(m, "Music");

  // Text layers in your Creatomate template are behaving like top-left boxes, not centered boxes.
  showLayer(m, "Title");
  m["Title.text"] = titleText;
  m["Title.font_family"] = titleFont;
  m["Title.font_size"] = titleSize;
  m["Title.fill_color"] = titleColor;
  m["Title.x"] = pctFromPreviewX(20);
  m["Title.y"] = pctFromPreviewY(titleTopPx);
  m["Title.width"] = pct(((PREVIEW_W - 40) / PREVIEW_W) * 100);
  m["Title.height"] = "16%";
  m["Title.time"] = 0;
  m["Title.duration"] = totalDuration;
  m["Title.text_align"] = "center";
  m["Title.stroke_color"] = "#000000";
  m["Title.stroke_width"] = Math.max(2, Math.round(titleSize * 0.06));
  m["Title.shadow_color"] = "#000000";
  m["Title.shadow_distance"] = Math.max(3, Math.round(titleSize * 0.08));

  let cursor = 0;
  items.forEach((item, index) => {
    const n = index + 1;
    const clipDur = safeDuration(item.duration, 4);
    const rankColor = normalizeHex(colors[index], ["#ff2d7a", "#ff9500", "#eaff00", "#00ff3b", "#00f5ff", "#a855f7", "#ffffff", "#5ac1ff", "#ff3b30"][index] || "#ffffff");
    const blurBgName = `Clip${n}_BlurBackground`;
    const fullBgName = `Clip${n}_FullBackground`;
    const fgName = `Clip${n}_Foreground`;
    const rankName = `Rank${n}`;

    [blurBgName, fullBgName].forEach((bgName) => {
      m[`${bgName}.source`] = item.videoUrl;
      m[`${bgName}.time`] = cursor;
      m[`${bgName}.duration`] = clipDur;
      m[`${bgName}.fit`] = "cover";
      m[`${bgName}.x`] = "50%";
      m[`${bgName}.y`] = "50%";
      m[`${bgName}.width`] = bgName === blurBgName ? "112%" : "100%";
      m[`${bgName}.height`] = bgName === blurBgName ? "112%" : "100%";
      m[`${bgName}.volume`] = "100%";
    });

    if (isFullMode) {
      showLayer(m, fullBgName);
      hideLayer(m, blurBgName);
      hideLayer(m, fgName);
    } else {
      showLayer(m, blurBgName);
      hideLayer(m, fullBgName);
      showLayer(m, fgName);
      m[`${fgName}.source`] = item.videoUrl;
      m[`${fgName}.time`] = cursor;
      m[`${fgName}.duration`] = clipDur;
      m[`${fgName}.fit`] = "cover";
      m[`${fgName}.x`] = pctFromPreviewX(foreCenterX);
      m[`${fgName}.y`] = pctFromPreviewY(foreCenterY);
      m[`${fgName}.width`] = `${foreSizePct}%`;
      m[`${fgName}.height`] = `${foreSizePct}%`;
      m[`${fgName}.volume`] = "100%";
    }

    showLayer(m, rankName);
    m[`${rankName}.text`] = `${n}. ${item.label}`;
    m[`${rankName}.time`] = cursor;
    m[`${rankName}.duration`] = Math.max(0.1, totalDuration - cursor);
    m[`${rankName}.font_family`] = rankFont;
    m[`${rankName}.font_size`] = rankLabelSize;
    m[`${rankName}.fill_color`] = rankColor;
    m[`${rankName}.x`] = pctFromPreviewX(rankLeftPx);
    m[`${rankName}.y`] = pctFromPreviewY(rankTopPx + index * lineSpacingPx);
    m[`${rankName}.width`] = pct(((PREVIEW_W - rankLeftPx - 10) / PREVIEW_W) * 100);
    m[`${rankName}.height`] = "8%";
    m[`${rankName}.text_align`] = "left";
    m[`${rankName}.stroke_color`] = "#000000";
    m[`${rankName}.stroke_width`] = Math.max(2, Math.round(rankLabelSize * 0.06));
    m[`${rankName}.shadow_color`] = "#000000";
    m[`${rankName}.shadow_distance`] = Math.max(3, Math.round(rankLabelSize * 0.08));

    cursor = Math.round((cursor + clipDur) * 1000) / 1000;
  });

  if (musicEnabled && musicUrl) {
    showLayer(m, "Music");
    m["Music.source"] = musicUrl;
    m["Music.time"] = 0;
    m["Music.duration"] = totalDuration;
    m["Music.volume"] = `${Math.round(musicVolume * 100)}%`;
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
      title: { text: titleText, font: titleFont, size: titlePreviewSize, color: titleColor, y: titleTopPx },
      ranks: { font: rankFont, labelSize: rankPreviewSize, x: rankLeftPx, y: rankTopPx, spacing: lineSpacingPx, colors },
      layout: { mode: isFullMode ? "full" : "blurred", foregroundX: foreLeftPx, foregroundY: foreTopPx, foregroundScale: foreScale, blurAmount: layout.blurAmount ?? layout.blur ?? 19 },
      music: { enabled: musicEnabled, url: musicUrl, volume: musicVolume },
      items: items.map((it) => ({ rank: it.rank, label: it.label, videoUrl: it.videoUrl, duration: it.duration, fileName: it.fileName })),
    },
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 200; res.end(); return; }

  try {
    if (!TEMPLATE_ID) return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_TOP5_VIDEO" });

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const id = url.searchParams.get("id");
      if (!id) return json(res, 400, { ok: false, error: "Missing id" });
      const r = await creatomateRequest(`/v1/renders/${encodeURIComponent(id)}`, "GET");
      const status = String(r?.status || "").toLowerCase();
      const finalUrl = r?.url || r?.result?.url || r?.outputs?.[0]?.url || "";
      return json(res, 200, { ok: true, status, url: finalUrl || null });
    }

    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Use POST or GET" });

    const body = await readBody(req);
    const member_id = await getMemberId(req);
    const sb = getAdminSupabase();
    const built = buildModifications(body);
    const { modifications, choices } = built;

    console.log("[top5-video] Starting render", {
      templateId: TEMPLATE_ID,
      rankCount: choices.rankCount,
      itemCount: choices.items.length,
      layoutMode: choices.layout.mode,
      totalDuration: choices.totalDuration,
      textPositions: {
        titleX: modifications["Title.x"],
        titleY: modifications["Title.y"],
        rank1X: modifications["Rank1.x"],
        rank1Y: modifications["Rank1.y"],
      },
      modificationKeys: Object.keys(modifications),
    });

    const firstLabel = choices.items?.find((x) => x?.label)?.label || "";
    const video_name = safeStr(body.video_name || body.videoName || "").trim() || safeStr(body.title?.text || "").replace(/\s+/g, " ").slice(0, 60) || firstLabel || `Top ${choices.rankCount} video`;

    const { data: inserted, error: insErr } = await sb
      .from("renders")
      .insert({ member_id, status: "rendering", render_id: null, video_url: null, error: null, kind: "top5_video", video_name, choices })
      .select("*")
      .single();

    if (insErr || !inserted?.id) {
      console.error("[top5-video] renders insert failed", insErr);
      return json(res, 500, { ok: false, error: "RENDERS_INSERT_FAILED", details: insErr });
    }

    const dbId = inserted.id;
    const publicBaseUrl = (process.env.API_BASE || "").trim() || `https://${req.headers.host}`;
    const webhook_url = `${publicBaseUrl}/api/creatomate-webhook?id=${encodeURIComponent(dbId)}&kind=main`;

    const startResp = await creatomateRequest("/v1/renders", "POST", {
      template_id: TEMPLATE_ID,
      modifications,
      output_format: "mp4",
      render_scale: 1,
      duration: choices.totalDuration,
      webhook_url,
    });

    const start = Array.isArray(startResp) ? startResp[0] : startResp;
    const renderId = start?.id;

    if (!renderId) {
      await sb.from("renders").update({ status: "failed", error: JSON.stringify({ error: "NO_RENDER_ID", startResp }) }).eq("id", dbId);
      return json(res, 502, { ok: false, error: "Creatomate did not return render id", raw: startResp });
    }

    await sb.from("renders").update({ render_id: renderId, status: "rendering", error: null }).eq("id", dbId);
    return json(res, 200, { ok: true, id: dbId, renderId, status: start?.status || "queued" });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = err?.code;
    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) return json(res, 401, { ok: false, error: "TOKEN_EXPIRED", message: "Session expired. Refresh and try again." });
    if (code === "MISSING_AUTH" || msg.includes("MISSING_AUTH")) return json(res, 401, { ok: false, error: "MISSING_AUTH" });
    if (code === "INVALID_MEMBER_TOKEN" || msg.includes("INVALID_MEMBER")) return json(res, 401, { ok: false, error: "INVALID_MEMBER_TOKEN" });
    if (code === "MISSING_MEMBERSTACK_SECRET_KEY") return json(res, 500, { ok: false, error: "MISSING_MEMBERSTACK_SECRET_KEY" });
    console.error("[top5-video] SERVER_ERROR", err);
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: msg, creatomateResponse: err?.creatomateResponse || null });
  }
};
