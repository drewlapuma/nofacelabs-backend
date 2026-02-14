// api/reddit-video.js (CommonJS, Node 18+)

const https = require("https");

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;
const TEMPLATE_ID = process.env.CREATOMATE_TEMPLATE_ID_REDDIT;

// ✅ ElevenLabs + Supabase Storage
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOICE_BUCKET = process.env.VOICE_BUCKET || "voiceovers";

// ✅ Used when UI sends "default" / empty
const DEFAULT_ELEVEN_VOICE_ID =
  process.env.DEFAULT_ELEVEN_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // fallback: Sarah

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
 */
function setMulti(m, paths, value) {
  for (const p of paths) m[p] = value;
}

/* ----------------- ElevenLabs + Supabase helpers ----------------- */

function randId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function elevenlabsTtsToMp3Buffer(text, voiceId) {
  if (!ELEVENLABS_API_KEY) throw new Error("Missing ELEVENLABS_API_KEY");
  if (!voiceId) throw new Error("Missing ElevenLabs voiceId");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(text || ""),
      model_id: "eleven_monolingual_v1",
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
  if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  if (!VOICE_BUCKET) throw new Error("Missing VOICE_BUCKET");

  const base = new URL(SUPABASE_URL);
  const hostname = base.hostname;

  const putPath = `/storage/v1/object/${encodeURIComponent(VOICE_BUCKET)}/${filePath}`;

  const res = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname,
        path: putPath,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          "Content-Type": "audio/mpeg",
          "Content-Length": mp3Buffer.length,
          "x-upsert": "true",
        },
      },
      (r) => {
        let out = "";
        r.on("data", (c) => (out += c));
        r.on("end", () => resolve({ status: r.statusCode, text: out }));
      }
    );
    req.on("error", reject);
    req.write(mp3Buffer);
    req.end();
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Supabase upload failed (${res.status}): ${res.text || "unknown error"}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${VOICE_BUCKET}/${filePath}`;
}

// UI sends real ElevenLabs voice IDs in option value.
// If empty/"default", return "".
function normalizeElevenVoiceId(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.toLowerCase() === "default") return "";
  return s;
}

// =====================================
// ✅ FULL UPDATED buildModifications()
// (only changed: captions support added)
// =====================================
async function buildModifications(body) {
  // -----------------------------
  // MP3 duration (buffer) helper
  // -----------------------------
  function mp3DurationSeconds(buf) {
    try {
      const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);

      let offset = 0;

      // ID3v2 tag skip
      if (b.length >= 10 && b.toString("utf8", 0, 3) === "ID3") {
        const size =
          ((b[6] & 0x7f) << 21) |
          ((b[7] & 0x7f) << 14) |
          ((b[8] & 0x7f) << 7) |
          (b[9] & 0x7f);
        offset = 10 + size;
      }

      const BITRATES = {
        // [versionIndex][layerIndex][bitrateIndex] kbps
        // versionIndex: 0=2.5,1=reserved,2=2,3=1
        // layerIndex: 1=III,2=II,3=I (we'll map)
        3: { // MPEG1
          3: [0,32,64,96,128,160,192,224,256,288,320,352,384,416,448], // Layer I
          2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],   // Layer II
          1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320],    // Layer III
        },
        2: { // MPEG2
          3: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
          2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
          1: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
        },
        0: { // MPEG2.5 (same as MPEG2 tables for bitrate)
          3: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
          2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
          1: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
        }
      };

      const SAMPLERATES = {
        3: [44100, 48000, 32000], // MPEG1
        2: [22050, 24000, 16000], // MPEG2
        0: [11025, 12000, 8000],  // MPEG2.5
      };

      let totalSamples = 0;
      let sampleRate = 44100; // fallback

      // scan frames
      let guard = 0;
      while (offset + 4 < b.length && guard++ < 200000) {
        // sync 11 bits (0xFFE)
        if (b[offset] !== 0xff || (b[offset + 1] & 0xe0) !== 0xe0) {
          offset += 1;
          continue;
        }

        const verBits = (b[offset + 1] >> 3) & 0x03;  // 00=2.5,10=2,11=1
        const layerBits = (b[offset + 1] >> 1) & 0x03; // 01=III,10=II,11=I
        if (verBits === 1 || layerBits === 0) { offset += 1; continue; }

        const versionIndex = verBits === 3 ? 3 : (verBits === 2 ? 2 : 0);
        const layerIndex = layerBits === 3 ? 3 : (layerBits === 2 ? 2 : 1);

        const bitrateIdx = (b[offset + 2] >> 4) & 0x0f;
        const srIdx = (b[offset + 2] >> 2) & 0x03;
        const padding = (b[offset + 2] >> 1) & 0x01;

        if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) { offset += 1; continue; }

        const brTable = BITRATES[versionIndex]?.[layerIndex];
        const srTable = SAMPLERATES[versionIndex];
        if (!brTable || !srTable) { offset += 1; continue; }

        const bitrateKbps = brTable[bitrateIdx];
        const sr = srTable[srIdx];
        if (!bitrateKbps || !sr) { offset += 1; continue; }

        sampleRate = sr;

        // samples per frame
        let samplesPerFrame;
        if (layerIndex === 3) { // Layer I
          samplesPerFrame = 384;
        } else if (layerIndex === 2) { // Layer II
          samplesPerFrame = 1152;
        } else { // Layer III
          samplesPerFrame = (versionIndex === 3) ? 1152 : 576;
        }

        // frame length
        let frameLen;
        if (layerIndex === 3) {
          // Layer I: (12 * bitrate / samplerate + padding) * 4
          frameLen = Math.floor((12 * (bitrateKbps * 1000) / sr + padding) * 4);
        } else {
          // Layer II/III:
          // MPEG1 Layer III: 144 * bitrate / sr + padding
          // MPEG2/2.5 Layer III: 72 * bitrate / sr + padding
          const coef = (layerIndex === 1 && versionIndex !== 3) ? 72 : 144;
          frameLen = Math.floor((coef * (bitrateKbps * 1000)) / sr + padding);
        }

        if (!Number.isFinite(frameLen) || frameLen <= 0) { offset += 1; continue; }

        totalSamples += samplesPerFrame;
        offset += frameLen;
      }

      if (totalSamples <= 0 || !sampleRate) return 0;
      return totalSamples / sampleRate;
    } catch {
      return 0;
    }
  }

  // -----------------------------
  // your existing setup
  // -----------------------------
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
  setMulti(m, ["share_dark.y", "post_card_dark.share_light.y"], pct(shareTextY));

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

  const postVoiceId = normalizeElevenVoiceId(body.postVoice) || DEFAULT_ELEVEN_VOICE_ID;
  const scriptVoiceId = normalizeElevenVoiceId(body.scriptVoice) || DEFAULT_ELEVEN_VOICE_ID;
  const scriptText = safeStr(body.script, "");

  // -----------------------------
  // timing
  // -----------------------------
    // -----------------------------
  // timing (use REAL audio lengths)
  // -----------------------------
  const CARD_EARLY_CUT = 1.1;
  const SCRIPT_OVERLAP = 0.2;

  // tail silence removal knobs (SAFE)
  const POST_TAIL_CUT = 0.15;      // tiny trim
  const SCRIPT_TAIL_CUT = 0.5;     // start here (not 2.2)
  const DUR_CUSHION = 0.55;        // protects against duration under-estimation
  const MIN_AUDIO = 0.6;

  // Post voice
  let postVoiceDur = 0;
  {
    const postMp3 = await elevenlabsTtsToMp3Buffer(postText, postVoiceId);
    const postPath = `reddit/${Date.now()}_${randId()}_post.mp3`;
    const postUrl = await uploadMp3ToSupabasePublic(postMp3, postPath);
    m["post_voice.source"] = postUrl;

    // measured duration + cushion (prevents early cutoff)
    const measured = mp3DurationSeconds(postMp3) || 0;
    const base = Math.max(MIN_AUDIO, measured + DUR_CUSHION);

    // trim, but NEVER trim more than 25% of the clip
    const maxCut = Math.min(POST_TAIL_CUT, base * 0.25);
    postVoiceDur = Math.max(MIN_AUDIO, base - maxCut);
  }

  // Now that we know real post duration, compute card + scriptStart from it
  const cardSecs = Math.max(0.35, postVoiceDur - CARD_EARLY_CUT);
  const scriptStart = Math.max(0, postVoiceDur - SCRIPT_OVERLAP);

  m["post_card_light.time"] = 0;
  m["post_card_light.duration"] = cardSecs;
  m["post_card_dark.time"] = 0;
  m["post_card_dark.duration"] = cardSecs;

  m["post_voice.time"] = 0;
  m["post_voice.duration"] = postVoiceDur;

  // Script voice
  let scriptVoiceDur = 0;
  if (scriptText) {
    const scriptMp3 = await elevenlabsTtsToMp3Buffer(scriptText, scriptVoiceId);
    const scriptPath = `reddit/${Date.now()}_${randId()}_script.mp3`;
    const scriptUrl = await uploadMp3ToSupabasePublic(scriptMp3, scriptPath);
    m["script_voice.source"] = scriptUrl;

    const measured = mp3DurationSeconds(scriptMp3) || 0;
    const base = Math.max(MIN_AUDIO, measured + DUR_CUSHION);

    // trim, but NEVER trim more than 25% of the clip
    const maxCut = Math.min(SCRIPT_TAIL_CUT, base * 0.25);
    scriptVoiceDur = Math.max(MIN_AUDIO, base - maxCut);

    m["script_voice.time"] = scriptStart;
    m["script_voice.duration"] = scriptVoiceDur;
  }

  // timeline end (based on trimmed audio)
  const TAIL_PAD = 0.12;
  const audioEnd = scriptText ? (scriptStart + scriptVoiceDur) : postVoiceDur;
  const totalTimelineSecs = Math.max(0.9, audioEnd + TAIL_PAD);

  m["Video.time"] = 0;
  m["Video.duration"] = totalTimelineSecs;


  // ==========================================================
  // ✅ CAPTIONS (Subtitles_* layers) - unchanged
  // ==========================================================
  const captionsEnabled =
    body.captionsEnabled === true ||
    String(body.captionsEnabled || "").toLowerCase() === "true" ||
    String(body.captionsEnabled || "") === "1";

  const styleRaw = String(body.captionStyle || "").trim().toLowerCase();
  const style = styleRaw === "karoke" ? "karaoke" : styleRaw;

  const captionSettings =
    body.captionSettings && typeof body.captionSettings === "object"
      ? body.captionSettings
      : (() => {
          try { return JSON.parse(String(body.captionSettings || "")); }
          catch { return null; }
        })();

  const captionsText = safeStr(body.script, "");

  const STYLE_TO_LAYER = {
    sentence: "Subtitles_Sentence",
    karaoke: "Subtitles_Karaoke",
    word: "Subtitles_Word",
    boldwhite: "Subtitles_BoldWhite",
    yellowpop: "Subtitles_YellowPop",
    minttag: "Subtitles_MintTag",
    outlinepunch: "Subtitles_OutlinePunch",
    blackbar: "Subtitles_BlackBar",
    highlighter: "Subtitles_Highlighter",
    neonglow: "Subtitles_NeonGlow",
    purplepop: "Subtitles_PurplePop",
    compactlowerthird: "Subtitles_CompactLowerThird",
    bouncepop: "Subtitles_BouncePop",
    redalert: "Subtitles_RedAlert",
    redtag: "Subtitles_RedTag",
  };

  const ALL_SUBTITLE_LAYERS = Object.values(STYLE_TO_LAYER);

  function applyCaptionSettings(layerName, s) {
    if (!s || typeof s !== "object") return;

    if (s.x != null) m[`${layerName}.x`] = pct(Number(s.x));
    if (s.y != null) m[`${layerName}.y`] = pct(Number(s.y));

    if (s.fontFamily) m[`${layerName}.font_family`] = String(s.fontFamily);
    if (s.fontSize != null) m[`${layerName}.font_size`] = Number(s.fontSize);
    if (s.fontWeight != null) m[`${layerName}.font_weight`] = Number(s.fontWeight);

    if (s.fillColor) m[`${layerName}.fill_color`] = String(s.fillColor);
    if (s.strokeColor) m[`${layerName}.stroke_color`] = String(s.strokeColor);
    if (s.strokeWidth != null) m[`${layerName}.stroke_width`] = Number(s.strokeWidth);

    if (s.backgroundColor) m[`${layerName}.background_color`] = String(s.backgroundColor);
    if (s.shadowColor) m[`${layerName}.shadow_color`] = String(s.shadowColor);

    if (s.textTransform) m[`${layerName}.text_transform`] = String(s.textTransform);
  }

  for (const layer of ALL_SUBTITLE_LAYERS) {
    m[`${layer}.hidden`] = true;
    m[`${layer}.opacity`] = "0%";
  }

  if (captionsEnabled && captionsText && scriptText) {
    const chosenLayer = STYLE_TO_LAYER[style] || STYLE_TO_LAYER.sentence;

    m[`${chosenLayer}.hidden`] = false;
    m[`${chosenLayer}.opacity`] = "100%";
    m[`${chosenLayer}.text`] = captionsText;

    m[`${chosenLayer}.time`] = scriptStart;
    m[`${chosenLayer}.duration`] = Math.max(0.1, totalTimelineSecs - scriptStart);

    applyCaptionSettings(chosenLayer, captionSettings);
  }

  return m;
}














module.exports = async function handler(req, res) {
  setCors(req, res);

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

    const modifications = await buildModifications(body);

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
