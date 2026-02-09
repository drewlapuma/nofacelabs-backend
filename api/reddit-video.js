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

async function readBody(req) {
  // Works reliably on Vercel Node serverless
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

async function elevenlabsTtsToMp3Buffer(text, voiceId) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Missing ELEVENLABS_API_KEY");

  // ElevenLabs TTS (mp3)
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(text || ""),
      model_id: "eleven_monolingual_v1", // you can change later
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${resp.status}): ${t || "unknown error"}`);
  }

  const arr = await resp.arrayBuffer();
  return Buffer.from(arr);
}

async function uploadMp3ToSupabasePublic(mp3Buffer, filePath) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_VOICE_BUCKET;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  if (!bucket) throw new Error("Missing SUPABASE_VOICE_BUCKET");

  // Storage upload endpoint (upsert=true so reruns overwrite)
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${filePath}?upsert=true`;

  const resp = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "audio/mpeg",
    },
    body: mp3Buffer,
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Supabase upload failed (${resp.status}): ${t || "unknown error"}`);
  }

  // Public URL (bucket must be public)
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
}

// helper: map your dropdown values to real ElevenLabs voice IDs
function mapUiVoiceToElevenId(v) {
  const s = String(v || "").trim().toLowerCase();

  // ✅ REPLACE these with your real ElevenLabs voice IDs
  const MAP = {
    default: "YOUR_ELEVEN_DEFAULT_VOICE_ID",
    voice1: "YOUR_ELEVEN_VOICE_1_ID",
    voice2: "YOUR_ELEVEN_VOICE_2_ID",
  };

  return MAP[s] || MAP.default;
}

async function buildModifications(body) {
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

  // --- your existing layout math unchanged ---
  const BG_WIDTH = 75;
  const BG_CENTER_X = 50;
  const cardRight = BG_CENTER_X + BG_WIDTH / 2;

  const charsPerLine = 36;
  const lineCount = Math.max(1, Math.ceil(postText.length / charsPerLine));
  const extraLines = Math.max(0, lineCount - 2);

  const baseBgH = 18;
  const baseBgY = 24.2746;
  const addPerLine = 2.8;

  let bgH = clamp(baseBgH + extraLines * addPerLine, baseBgH, 45);
  const deltaH = bgH - baseBgH;

  let bgY = baseBgY + deltaH / 2;

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

  const BASE_LIKE_TEXT_X = 19.0572;
  const BASE_COMMENT_ICON_X = 29.0172;
  const BASE_COMMENT_TEXT_X = 31.6676;
  const BASE_SHARE_ICON_X = 71.279;
  const BASE_SHARE_TEXT_X = 74.5318;

  const likeLen = String(likes || "").length;
  const shareLen = String(shareText || "").length;

  const likeLong = likeLen > 4;
  const shareLong = shareLen > 6;

  let shareTextX = BASE_SHARE_TEXT_X;
  let shareIconX = BASE_SHARE_ICON_X;

  if (shareLong) {
    const RIGHT_PAD = 3.2;
    const shareRightX = cardRight - RIGHT_PAD;
    const estShareTextW = clamp(shareLen * 1.7, 6, 42);
    const SHARE_ICON_GAP = 5.5;
    shareTextX = shareRightX;
    shareIconX = shareTextX - estShareTextW - SHARE_ICON_GAP;
  }

  let commentTextX = BASE_COMMENT_TEXT_X;
  let commentIconX = BASE_COMMENT_ICON_X;

  if (likeLong) {
    const likeExtra = Math.max(0, likeLen - 3);
    const likeShift = clamp(likeExtra * 1.35, 0, 22);

    commentTextX = BASE_COMMENT_TEXT_X + likeShift;
    commentIconX = commentTextX - (BASE_COMMENT_TEXT_X - BASE_COMMENT_ICON_X);

    const estLikeTextW = clamp(likeLen * 1.7, 6, 42);
    const LIKE_CLEAR_GAP = 7.5;
    const minCommentIconX = BASE_LIKE_TEXT_X + estLikeTextW + LIKE_CLEAR_GAP;

    if (commentIconX < minCommentIconX) {
      commentIconX = minCommentIconX;
      commentTextX = commentIconX + (BASE_COMMENT_TEXT_X - BASE_COMMENT_ICON_X);
    }

    const maxCommentTextX = shareLong ? shareIconX - 7.0 : BASE_SHARE_ICON_X - 6.0;
    if (commentTextX > maxCommentTextX) {
      commentTextX = maxCommentTextX;
      commentIconX = commentTextX - (BASE_COMMENT_TEXT_X - BASE_COMMENT_ICON_X);
    }
  }

  const OP_ON = "100%";
  const OP_OFF = "0%";
  const m = {};

  // show/hide light/dark
  m["post_card_light.hidden"] = !showLight;
  m["post_card_light.opacity"] = showLight ? OP_ON : OP_OFF;

  m["post_card_dark.hidden"] = !showDark;
  m["post_card_dark.opacity"] = showDark ? OP_ON : OP_OFF;

  // bg sizing
  setMulti(m, ["post_bg_light.y", "post_card_light.post_bg_light.y"], pct(bgY));
  setMulti(m, ["post_bg_light.height", "post_card_light.post_bg_light.height"], pct(bgH));
  setMulti(m, ["post_bg_dark.y", "post_card_dark.post_bg_dark.y"], pct(bgY));
  setMulti(m, ["post_bg_dark.height", "post_card_dark.post_bg_dark.height"], pct(bgH));

  // texts
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

  // footer Y
  setMulti(m, ["like_count_light.y", "post_card_light.like_count_light.y"], pct(likeY));
  setMulti(m, ["like_count_dark.y", "post_card_dark.like_count_dark.y"], pct(likeY));

  setMulti(m, ["comment_count_light.y", "post_card_light.comment_count_light.y"], pct(commentY));
  setMulti(m, ["comment_count_dark.y", "post_card_dark.comment_count_dark.y"], pct(commentY));

  setMulti(m, ["share_light.y", "post_card_light.share_light.y"], pct(shareTextY));
  setMulti(m, ["share_dark.y", "post_card_dark.share_dark.y"], pct(shareTextY));

  setMulti(m, ["icon_like.y", "post_card_light.icon_like.y", "post_card_dark.icon_like.y"], pct(iconLikeY));
  setMulti(m, ["icon_comment.y", "post_card_light.icon_comment.y", "post_card_dark.icon_comment.y"], pct(iconCommentY));
  setMulti(m, ["icon_share.y", "post_card_light.icon_share.y", "post_card_dark.icon_share.y"], pct(iconShareY));

  // comment X
  setMulti(m, ["icon_comment.x", "post_card_light.icon_comment.x", "post_card_dark.icon_comment.x"], pct(commentIconX));
  setMulti(m, ["comment_count_light.x", "post_card_light.comment_count_light.x"], pct(commentTextX));
  setMulti(m, ["comment_count_dark.x", "post_card_dark.comment_count_dark.x"], pct(commentTextX));

  // share anchor + X
  if (shareLong) {
    setMulti(m, ["share_light.x_anchor", "post_card_light.share_light.x_anchor"], "100%");
    setMulti(m, ["share_dark.x_anchor", "post_card_dark.share_dark.x_anchor"], "100%");
  } else {
    setMulti(m, ["share_light.x_anchor", "post_card_light.share_light.x_anchor"], "0%");
    setMulti(m, ["share_dark.x_anchor", "post_card_dark.share_dark.x_anchor"], "0%");
  }

  setMulti(m, ["share_light.x", "post_card_light.share_light.x"], pct(shareTextX));
  setMulti(m, ["share_dark.x", "post_card_dark.share_dark.x"], pct(shareTextX));
  setMulti(m, ["icon_share.x", "post_card_light.icon_share.x", "post_card_dark.icon_share.x"], pct(shareIconX));

  // sources
  if (pfpUrl) {
    setMulti(m, ["pfp_light.source", "post_card_light.pfp_light.source"], pfpUrl);
    setMulti(m, ["pfp_dark.source", "post_card_dark.pfp_dark.source"], pfpUrl);
  }

  if (bgUrl) {
    m["Video.source"] = bgUrl;
    m["Video.fit"] = "cover";
  }

  // ✅ NEW: ElevenLabs -> MP3 -> Supabase -> Creatomate Audio sources
  const postVoiceId = mapUiVoiceToElevenId(body.postVoice);
  const scriptVoiceId = mapUiVoiceToElevenId(body.scriptVoice);

  const postAudio = await elevenlabsTtsToMp3Buffer(postText, postVoiceId);
  const scriptAudio = await elevenlabsTtsToMp3Buffer(safeStr(body.script, ""), scriptVoiceId);

  const stamp = Date.now();
  const postAudioUrl = await uploadMp3ToSupabasePublic(postAudio, `reddit/${stamp}-post.mp3`);
  const scriptAudioUrl = await uploadMp3ToSupabasePublic(scriptAudio, `reddit/${stamp}-script.mp3`);

  m["post_voice.source"] = postAudioUrl;
  m["script_voice.source"] = scriptAudioUrl;

  return m;
}




module.exports = async function handler(req, res) {
  setCors(req, res);

  // ✅ FIX: preflight must return 200 WITH CORS headers
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

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
