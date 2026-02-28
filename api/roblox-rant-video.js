// api/roblox-rant-video.js (CommonJS, Node 18+)
// ✅ Roblox Rants render endpoint (Voice + Video + Captions)
// ✅ Uses your existing captions layer naming (Subtitles_*)
// ✅ Uses Creatomate template you provided
// ✅ Writes to Supabase "renders" so it appears in /my-videos
// ✅ Auth via Authorization Bearer OR x-nf-member-id (fallback)

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

const CREATOMATE_API_KEY = process.env.CREATOMATE_API_KEY;

// Prefer env, but fallback to the ID you pasted
const TEMPLATE_ID =
  process.env.CREATOMATE_TEMPLATE_ID_ROBLOX_RANTS ||
  process.env.CREATOMATE_TEMPLATE_ID_RR ||
  "2ac3f0fc-9176-4f86-8b3a-22ac48f2a0a9";

// ElevenLabs + Supabase
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOICE_BUCKET = process.env.VOICE_BUCKET || "voiceovers";

const DEFAULT_ELEVEN_VOICE_ID =
  process.env.DEFAULT_ELEVEN_VOICE_ID || "EXAVITQu4vr4xnSDxMaL"; // fallback Sarah

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

function clampNum(n, a, b, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(a, Math.min(b, n));
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

function randId(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeElevenVoiceId(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.toLowerCase() === "default") return "";
  return s;
}

// -------------------- ElevenLabs + Supabase upload --------------------
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

// -------------------- MP3 duration helper --------------------
function mp3DurationSeconds(buf) {
  try {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let offset = 0;

    if (b.length >= 10 && b.toString("utf8", 0, 3) === "ID3") {
      const size =
        ((b[6] & 0x7f) << 21) |
        ((b[7] & 0x7f) << 14) |
        ((b[8] & 0x7f) << 7) |
        (b[9] & 0x7f);
      offset = 10 + size;
    }

    const BITRATES = {
      3: {
        3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
        2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
        1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
      },
      2: {
        3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
        1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
      },
      0: {
        3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
        2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
        1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
      },
    };

    const SAMPLERATES = {
      3: [44100, 48000, 32000],
      2: [22050, 24000, 16000],
      0: [11025, 12000, 8000],
    };

    let totalSamples = 0;
    let sampleRate = 44100;

    let guard = 0;
    while (offset + 4 < b.length && guard++ < 200000) {
      if (b[offset] !== 0xff || (b[offset + 1] & 0xe0) !== 0xe0) {
        offset += 1;
        continue;
      }

      const verBits = (b[offset + 1] >> 3) & 0x03;
      const layerBits = (b[offset + 1] >> 1) & 0x03;
      if (verBits === 1 || layerBits === 0) {
        offset += 1;
        continue;
      }

      const versionIndex = verBits === 3 ? 3 : verBits === 2 ? 2 : 0;
      const layerIndex = layerBits === 3 ? 3 : layerBits === 2 ? 2 : 1;

      const bitrateIdx = (b[offset + 2] >> 4) & 0x0f;
      const srIdx = (b[offset + 2] >> 2) & 0x03;
      const padding = (b[offset + 2] >> 1) & 0x01;

      if (bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) {
        offset += 1;
        continue;
      }

      const brTable = BITRATES[versionIndex]?.[layerIndex];
      const srTable = SAMPLERATES[versionIndex];
      if (!brTable || !srTable) {
        offset += 1;
        continue;
      }

      const bitrateKbps = brTable[bitrateIdx];
      const sr = srTable[srIdx];
      if (!bitrateKbps || !sr) {
        offset += 1;
        continue;
      }
      sampleRate = sr;

      let samplesPerFrame;
      if (layerIndex === 3) samplesPerFrame = 384;
      else if (layerIndex === 2) samplesPerFrame = 1152;
      else samplesPerFrame = versionIndex === 3 ? 1152 : 576;

      let frameLen;
      if (layerIndex === 3) {
        frameLen = Math.floor((12 * (bitrateKbps * 1000) / sr + padding) * 4);
      } else {
        const coef = layerIndex === 1 && versionIndex !== 3 ? 72 : 144;
        frameLen = Math.floor((coef * (bitrateKbps * 1000)) / sr + padding);
      }

      if (!Number.isFinite(frameLen) || frameLen <= 0) {
        offset += 1;
        continue;
      }

      totalSamples += samplesPerFrame;
      offset += frameLen;
    }

    if (totalSamples <= 0 || !sampleRate) return 0;
    return totalSamples / sampleRate;
  } catch {
    return 0;
  }
}

// -------------------- ✅ FFmpeg transform (speed + pitch + volume baked in) --------------------
// speed: 1.0–2.0 (duration changes)
// pitch: 0.1–2.0 (duration preserved)
// volume: 0–1.5
function atempoChain(mult) {
  let m = Number(mult);
  if (!Number.isFinite(m) || m <= 0) m = 1;

  const parts = [];
  // reduce large multipliers
  while (m > 2.0 + 1e-9) {
    parts.push(2.0);
    m /= 2.0;
  }
  // increase small multipliers
  while (m < 0.5 - 1e-9) {
    parts.push(0.5);
    m /= 0.5; // equivalent to m *= 2
  }
  // remainder in [0.5, 2.0]
  parts.push(m);

  // clean rounding
  return parts
    .map((x) => {
      const v = Math.max(0.5, Math.min(2.0, x));
      return Number(v.toFixed(6));
    })
    .filter((x) => Number.isFinite(x) && x > 0);
}

async function transformMp3WithFfmpeg(mp3Buffer, speed, pitch, volume) {
  const sp = clampNum(speed, 1.0, 2.0, 1.0);
  const pi = clampNum(pitch, 0.1, 2.0, 1.0);
  const vol = clampNum(volume, 0.0, 1.5, 1.0);

  // If nothing to do
  if (Math.abs(sp - 1.0) < 0.001 && Math.abs(pi - 1.0) < 0.001 && Math.abs(vol - 1.0) < 0.001) {
    return mp3Buffer;
  }

  if (!ffmpegPath) throw new Error("ffmpeg-static not available. Install ffmpeg-static.");

  const tmpIn = path.join("/tmp", `nf_in_${Date.now()}_${randId()}.mp3`);
  const tmpOut = path.join("/tmp", `nf_out_${Date.now()}_${randId()}.mp3`);

  fs.writeFileSync(tmpIn, mp3Buffer);

  // ✅ Use explicit sample rate (mp3 is typically 44100; ElevenLabs returns 44100 in your logs)
  const SR = 44100;

  // Pitch shift preserving duration:
  // asetrate=SR*pitch, aresample=SR, atempo=(speed/pitch)
  const tempo = sp / pi;
  const tempoParts = atempoChain(tempo);
  const tempoFilter = tempoParts.map((x) => `atempo=${x}`).join(",");

  const afilter = [
    `asetrate=${Math.round(SR * pi)}`,
    `aresample=${SR}`,
    tempoFilter,
    `volume=${vol}`,
  ].filter(Boolean).join(",");

  const args = [
    "-y",
    "-i", tmpIn,
    "-vn",
    "-af", afilter,
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    tmpOut,
  ];

  await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let err = "";
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(-2000)}`));
    });
  });

  const outBuf = fs.readFileSync(tmpOut);

  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}

  return outBuf;
}


// -------------------- buildModifications (Roblox Rants) --------------------
async function buildModifications(body) {
  const END_PAD = 0.4;

  const script = safeStr(body.script || body.text || "");
  if (!script) throw new Error("Missing script");

  const bgUrl = ensurePublicHttpUrl(body.backgroundVideoUrl, "backgroundVideoUrl");

  // Voice settings from UI
  const voiceId = normalizeElevenVoiceId(body.voiceId || body.voice || body.rrVoiceId) || DEFAULT_ELEVEN_VOICE_ID;

  // Speed: 1.0–2.0
  const voiceSpeed = clampNum(body.voiceSpeed ?? body.speed ?? body.rrSpeed, 1.0, 2.0, 1.0);

  // Pitch: 0.1–2.0
  const voicePitch = clampNum(body.voicePitch ?? body.pitch ?? body.rrPitch, 0.1, 2.0, 1.0);

  const voiceVolume = clampNum(body.voiceVolume ?? body.volume ?? 1.0, 0.0, 1.5, 1.0);

  // Generate + bake transforms
  const mp3Raw = await elevenlabsTtsToMp3Buffer(script, voiceId);
  const mp3Final = await transformMp3WithFfmpeg(mp3Raw, voiceSpeed, voicePitch, voiceVolume);

  const mp3Path = `roblox_rants/${Date.now()}_${randId()}_voice.mp3`;
  const mp3Url = await uploadMp3ToSupabasePublic(mp3Final, mp3Path);

  let dur = mp3DurationSeconds(mp3Final) || 0;
  dur = Math.max(0.6, dur);
  const total = Math.max(0.9, dur + END_PAD);

  const m = {};

  // ✅ IMPORTANT: your template layer names are capitalized
  m["Voice.source"] = mp3Url;
  m["Voice.time"] = 0;
  m["Voice.duration"] = dur;
  m["Voice.playback_rate"] = 1;

  m["Video.source"] = bgUrl;
  m["Video.fit"] = "cover";
  m["Video.time"] = 0;
  m["Video.duration"] = total;

  // ==========================================================
  // ✅ CAPTIONS (same mapping you already use)
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
          try { return JSON.parse(String(body.captionSettings || "")); } catch { return null; }
        })();

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

  function forceHideLayer(layerName) {
    m[`${layerName}.hidden`] = true;
    m[`${layerName}.opacity`] = "0%";
    m[`${layerName}.visible`] = false;
    m[`${layerName}.enabled`] = false;
    m[`${layerName}.transcription`] = false;
    m[`${layerName}.transcription.enabled`] = false;

    // prevent “ghost background”
    m[`${layerName}.background_color`] = "transparent";
    m[`${layerName}.shadow_color`] = "transparent";
    m[`${layerName}.shadow_blur`] = 0;
    m[`${layerName}.shadow_distance`] = 0;
  }

  function forceShowLayer(layerName) {
    m[`${layerName}.hidden`] = false;
    m[`${layerName}.opacity`] = "100%";
    m[`${layerName}.visible`] = true;
    m[`${layerName}.enabled`] = true;
  }

  function applyCaptionSettings(layerName, styleKey, s) {
    // defaults: keep clean
    m[`${layerName}.background_color`] = "transparent";
    m[`${layerName}.shadow_color`] = "transparent";
    m[`${layerName}.shadow_blur`] = 0;
    m[`${layerName}.shadow_distance`] = 0;

    if (!s || typeof s !== "object") return;

    if (s.x != null) m[`${layerName}.x`] = pct(Number(s.x));
    if (s.y != null) m[`${layerName}.y`] = pct(Number(s.y));

    if (s.fontFamily) m[`${layerName}.font_family`] = String(s.fontFamily);
    if (s.fontSize != null) m[`${layerName}.font_size`] = Number(s.fontSize);
    if (s.fontWeight != null) m[`${layerName}.font_weight`] = Number(s.fontWeight);

    if (s.fillColor) m[`${layerName}.fill_color`] = String(s.fillColor);
    if (s.strokeColor) m[`${layerName}.stroke_color`] = String(s.strokeColor);
    if (s.strokeWidth != null) m[`${layerName}.stroke_width`] = Number(s.strokeWidth);

    if (s.textTransform) m[`${layerName}.text_transform`] = String(s.textTransform);

    if (styleKey === "blackbar" && s.backgroundColor) {
      m[`${layerName}.background_color`] = String(s.backgroundColor);
    }

    if (styleKey === "neonglow" && s.shadowColor) {
      m[`${layerName}.shadow_color`] = String(s.shadowColor);
      if (s.shadowBlur != null) m[`${layerName}.shadow_blur`] = Number(s.shadowBlur);
      if (s.shadowDistance != null) m[`${layerName}.shadow_distance`] = Number(s.shadowDistance);
    }
  }

  for (const layer of ALL_SUBTITLE_LAYERS) forceHideLayer(layer);

  if (captionsEnabled && script) {
    const chosenLayer = STYLE_TO_LAYER[style] || STYLE_TO_LAYER.sentence;

    forceShowLayer(chosenLayer);

    m[`${chosenLayer}.dynamic`] = true;
    m[`${chosenLayer}.transcription`] = true;
    m[`${chosenLayer}.transcription.enabled`] = true;

    // ✅ IMPORTANT: transcription source is the "Voice" layer
    m[`${chosenLayer}.transcription.source`] = "Voice";
    m[`${chosenLayer}.transcription_source`] = "Voice";

    m[`${chosenLayer}.time`] = 0;
    m[`${chosenLayer}.duration`] = total;

    applyCaptionSettings(chosenLayer, style, captionSettings);
  }

  return m;
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
    if (!TEMPLATE_ID) return json(res, 500, { ok: false, error: "Missing TEMPLATE_ID" });

    // Optional polling helper (like reddit)
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

    const script = safeStr(body.script || body.text || "");
    const backgroundVideoUrl = safeStr(body.backgroundVideoUrl || "");
    if (!script) return json(res, 400, { ok: false, error: "Missing script" });
    if (!backgroundVideoUrl) return json(res, 400, { ok: false, error: "Missing backgroundVideoUrl" });

    // Validate URL early
    ensurePublicHttpUrl(backgroundVideoUrl, "backgroundVideoUrl");

    // ✅ must be logged in (token OR x-nf-member-id)
    const member_id = await getMemberId(req);

    const sb = getAdminSupabase();

    const video_name =
      safeStr(body.video_name || body.videoName || "").trim() ||
      safeStr(script).slice(0, 60) ||
      "Roblox rant video";

    // Build modifications FIRST (so we fail before DB insert if something is wrong)
    const modifications = await buildModifications(body);

    const choices = {
      kind: "roblox_rants",
      script,
      backgroundVideoUrl,
      voiceId: safeStr(body.voiceId || body.voice || body.rrVoiceId || ""),
      voiceSpeed: clampNum(body.voiceSpeed ?? body.speed ?? body.rrSpeed, 1.0, 2.0, 1.0),
      voicePitch: clampNum(body.voicePitch ?? body.pitch ?? body.rrPitch, 0.1, 2.0, 1.0),
      voiceVolume: clampNum(body.voiceVolume ?? body.volume ?? 1.0, 0.0, 1.5, 1.0),

      captionsEnabled: Boolean(body.captionsEnabled),
      captionStyle: safeStr(body.captionStyle || ""),
      captionSettings: body.captionSettings || null,
    };

    // ✅ Insert renders FIRST so /api/renders shows it immediately
    const { data: inserted, error: insErr } = await sb
      .from("renders")
      .insert({
        member_id,
        status: "rendering",
        render_id: null,
        video_url: null,
        error: null,
        kind: "roblox_rants",
        video_name,
        choices,
      })
      .select("*")
      .single();

    if (insErr || !inserted?.id) {
      console.error("[roblox-rant-video] renders insert failed", insErr);
      return json(res, 500, { ok: false, error: "RENDERS_INSERT_FAILED", details: insErr });
    }

    const dbId = inserted.id;

    // ✅ Start Creatomate render with webhook to your existing webhook handler
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

      return json(res, 502, { ok: false, error: "Creatomate did not return render id", raw: startResp });
    }

    // ✅ Store Creatomate render_id on the row
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
      id: dbId,      // renders.id
      renderId,      // creatomate render id
      status: start?.status || "queued",
    });
  } catch (err) {
    const msg = String(err?.message || err);
    const code = err?.code;

    if (code === "TOKEN_EXPIRED" || msg.includes("TOKEN_EXPIRED")) {
      return json(res, 401, { ok: false, error: "TOKEN_EXPIRED", message: "Session expired. Refresh and try again." });
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

    console.error("[roblox-rant-video] SERVER_ERROR", err);
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: msg });
  }
};
