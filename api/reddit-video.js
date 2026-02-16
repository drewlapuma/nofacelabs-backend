// api/reddit-video.js (CommonJS, Node 18+)
// ✅ Writes to Supabase "renders" table so Reddit videos appear in /myvideos
// ✅ CORS updated to allow X-NF-Member-Id / X-NF-Member-Email (fixes your preflight error)
// ✅ Auth updated: accepts x-nf-member-id header FIRST (no JWT required), falls back to Bearer token if present
//
// Flow:
// 1) Identify member_id (x-nf-member-id OR Authorization: Bearer <token>)
// 2) Insert row into renders (status=rendering, kind=reddit)
// 3) Start Creatomate with webhook => /api/creatomate-webhook?id=<dbId>&kind=main
// 4) Update row with render_id
// 5) Webhook updates video_url when done

const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const memberstackAdmin = require("@memberstack/admin");
const { getAdminSupabase } = require("./_lib/supabase");

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

  // ✅ FIX: allow your custom headers in preflight
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-NF-Member-Id, X-NF-Member-Email"
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

function getHeader(req, name) {
  // Node lowercases header keys
  const key = String(name || "").toLowerCase();
  return req.headers[key];
}

async function requireMemberId(req) {
  // ✅ NO-JWT path: accept member id from header if provided
  const headerId = getHeader(req, "x-nf-member-id");
  if (headerId) {
    const id = String(headerId).trim();
    if (id) return id;
  }

  // ✅ fallback (optional): Bearer token verification if you enable it later
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

function normalizeElevenVoiceId(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.toLowerCase() === "default") return "";
  return s;
}

/* ----------------- ✅ FFmpeg audio transform (speed + volume baked in) ----------------- */

function clampNum(n, a, b, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(a, Math.min(b, n));
}

async function transformMp3WithFfmpeg(mp3Buffer, speed, volume) {
  const sp = clampNum(speed, 0.5, 2.0, 1.0);
  const vol = clampNum(volume, 0.0, 1.5, 1.0);

  if (Math.abs(sp - 1.0) < 0.001 && Math.abs(vol - 1.0) < 0.001) {
    return mp3Buffer;
  }

  if (!ffmpegPath) throw new Error("ffmpeg-static not available. Install ffmpeg-static.");

  const tmpIn = path.join("/tmp", `nf_in_${Date.now()}_${randId()}.mp3`);
  const tmpOut = path.join("/tmp", `nf_out_${Date.now()}_${randId()}.mp3`);

  fs.writeFileSync(tmpIn, mp3Buffer);

  const afilter = `atempo=${sp},volume=${vol}`;
  const args = ["-y", "-i", tmpIn, "-vn", "-af", afilter, "-codec:a", "libmp3lame", "-b:a", "192k", tmpOut];

  await new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args);
    let err = "";
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg failed (code ${code}): ${err.slice(-1200)}`));
    });
  });

  const outBuf = fs.readFileSync(tmpOut);

  try { fs.unlinkSync(tmpIn); } catch {}
  try { fs.unlinkSync(tmpOut); } catch {}

  return outBuf;
}

/* ----------------- MP3 duration helper (buffer -> seconds) ----------------- */

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

/* ----------------- ✅ buildModifications() ----------------- */
// KEEP your working function body here (unchanged)
async function buildModifications(body) {
  // ... KEEP YOUR EXISTING buildModifications CONTENT ...
  throw new Error("buildModifications() placeholder — paste your existing function body here unchanged.");
}

/* ----------------- MAIN handler ----------------- */

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (!TEMPLATE_ID) return json(res, 500, { ok: false, error: "Missing CREATOMATE_TEMPLATE_ID_REDDIT" });

    // NOTE: GET stays as your polling helper (optional)
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

    // ✅ must be logged in (header member id OR bearer token)
    const member_id = await requireMemberId(req);
    const sb = getAdminSupabase();

    const body = await readBody(req);

    const username = safeStr(body.username);
    const postText = safeStr(body.postText || body.postTitle);
    const postTitle = safeStr(body.postTitle || "");
    const backgroundVideoUrl = safeStr(body.backgroundVideoUrl);
    const pfpUrl = safeStr(body.pfpUrl || "");

    if (!username) return json(res, 400, { ok: false, error: "Missing username" });
    if (!postText) return json(res, 400, { ok: false, error: "Missing postText" });
    if (!backgroundVideoUrl) return json(res, 400, { ok: false, error: "Missing backgroundVideoUrl" });

    // ✅ validate URLs now (fail early)
    ensurePublicHttpUrl(pfpUrl, "pfpUrl");
    ensurePublicHttpUrl(backgroundVideoUrl, "backgroundVideoUrl");

    // ✅ 1) Insert row into renders FIRST so /api/renders will list it
    const video_name =
      safeStr(body.video_name || body.videoName || "").trim() ||
      safeStr(postTitle).slice(0, 80) ||
      "Reddit video";

    const { data: inserted, error: insErr } = await sb
      .from("renders")
      .insert({
        member_id,
        status: "rendering",
        render_id: null,
        video_url: null,
        error: null,
        kind: "reddit",
        video_name,
        // keep anything useful for later display/filtering
        choices: {
          kind: "reddit",
          mode: normalizeMode(body.mode),
          username,
          postTitle: postTitle || null,
          postText,
          pfpUrl,
          backgroundVideoUrl,
          backgroundVideoName: safeStr(body.backgroundVideoName || ""),
          captionsEnabled: Boolean(body.captionsEnabled),
          captionStyle: safeStr(body.captionStyle || ""),
        },
      })
      .select("*")
      .single();

    if (insErr || !inserted?.id) {
      console.error("[reddit-video] renders insert failed", insErr);
      return json(res, 500, { ok: false, error: "RENDERS_INSERT_FAILED", details: insErr });
    }

    const dbId = inserted.id;

    // ✅ 2) Build modifications (your existing function)
    const modifications = await buildModifications(body);

    // ✅ 3) Start Creatomate render WITH webhook pointing to db row id
    const publicBaseUrl =
      (process.env.API_BASE || "").trim() ||
      `https://${req.headers.host}`;

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
      // mark row failed (so user sees it + error)
      await sb
        .from("renders")
        .update({
          status: "failed",
          error: JSON.stringify({ error: "NO_RENDER_ID", startResp }),
        })
        .eq("id", dbId);

      return json(res, 502, { ok: false, error: "Creatomate did not return render id", raw: startResp });
    }

    // ✅ 4) Store Creatomate render_id on the DB row
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
      id: dbId,     // renders.id (uuid)
      renderId,     // creatomate render id
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

    console.error("[reddit-video] SERVER_ERROR", err);
    return json(res, 500, { ok: false, error: "SERVER_ERROR", message: msg });
  }
};
