(function () {
  if (window.__nf_reddit_preview_v14_tokenfix__) return;
  window.__nf_reddit_preview_v14_tokenfix__ = true;

  const API_BASE = "https://nofacelabs-backend.vercel.app";
  const SIGNED_UPLOAD_ENDPOINT = API_BASE + "/api/user-video-upload-url";
  const SCRIPT_ENDPOINT = API_BASE + "/api/reddit-script";

  const DEMO_GAMEPLAY_URL =
    "https://pub-5be7d792161d46a4baac27fb3dc5ae4c.r2.dev/Minecraftparkour-1.mp4";

  const DEFAULT_PFP_URL =
    "https://pcbrxphrufkzuhuuisul.supabase.co/storage/v1/object/public/reddit-pfps/reddit-pfps/redditbluepfp2.1.png";

  const FLAIRS = [
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair1.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair2invis.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair3invis.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair4invis.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair5-removebg-preview.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair6.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair7.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair8.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair9.png",
    "https://pub-893d3b83680c4b839093dfb1ace5ac0a.r2.dev/flair10.png",
  ];

  // ----------------------------
  // ✅ VOICES (with descriptions)
  // ----------------------------
  const VOICES = [
    { name: "Bella", id: "hpp4J3VqNfWAUOO0d1Us", desc: "Warm, friendly female voice." },
    { name: "Roger", id: "CwhRBWXzGAHq8TQ4Fs17", desc: "Confident male narration with clear delivery." },
    { name: "Sarah", id: "EXAVITQu4vr4xnSDxMaL", desc: "Natural female storyteller with clean tone." },
    { name: "Laura", id: "FGY2WhTYpPnrIDTdsKH5", desc: "Smooth female voice with calm pacing." },
    { name: "Charlie", id: "IKne3meq5aSn9XLyUdCD", desc: "Energetic male voice with playful vibe." },
    { name: "George", id: "JBFqnCBsd6RMkjVDRZzb", desc: "Deep male voice, steady and dramatic." },
    { name: "Callum", id: "N2lVS1w4EtoT3dr4eOWO", desc: "Neutral male voice, versatile for any script." },
    { name: "River", id: "SAz9YHcvj6GT2YYXdXww", desc: "Fast, engaging voice for short-form hooks." },
    { name: "Harry", id: "SOYHLrjzK2X1ezoPC6cr", desc: "Crisp narrator tone with strong clarity." },
    { name: "Liam", id: "TX3LPaxmHKxFdv7VOQHJ", desc: "Relaxed male voice with casual delivery." },
    { name: "Alice", id: "Xb7hH8MSUJpSbSDYk0k2", desc: "Bright, friendly female voice." },
    { name: "Matilda", id: "XrExE9yKIg1WjnnlVkGX", desc: "Soft female voice for emotional storytelling." },
    { name: "Will", id: "bIHbv24MWmeRgasZH58o", desc: "Punchy male voice with strong emphasis." },
    { name: "Jessica", id: "cgSgspJ2msm6clMCkdW9", desc: "Upbeat modern female voice." },
    { name: "Eric", id: "cjVigY5qzO86Huf0OWal", desc: "Confident narration with steady rhythm." },
    { name: "Chris", id: "iP95p4xoKVk53GoZ742B", desc: "Friendly conversational male voice." },
    { name: "Brian", id: "nPczCjzI2devNBz1zQrb", desc: "Deeper male voice for dramatic reads." },
    { name: "Daniel", id: "onwK4e9ZLuTAKqWW03F9", desc: "Clear male voice, simple and direct." },
    { name: "Lily", id: "pFZP5JQG7iQjIQuC4Bku", desc: "Light, expressive female voice." },
    { name: "Adam", id: "pNInz6obpgDQGcFmaJgB", desc: "Neutral male voice, clean delivery." },
    { name: "Bill", id: "pqHfZKP75CvOlQylNhV4", desc: "Older male voice, classic storyteller feel." },
    { name: "Alex", id: "yl2ZDV1MzN4HbQJbMihG", desc: "Modern neutral voice (great all-purpose)." },
    { name: "Mark", id: "3jR9BuQAOPMWUjWpi0ll", desc: "Strong voice that hits punchlines well." },
    { name: "Brittney", id: "kPzsL2i3teMYv0FxEYQ6", desc: "High-energy female voice for hooks." },
    { name: "True", id: "tZssYepgGaQmegsMEXjK", desc: "Smooth confident voice with quick pacing." },
    { name: "Charles", id: "S9GPGBaMND8XWwwzxQXp", desc: "Formal narrator tone, very clear." },
    { name: "Clancy", id: "FLpz0UhC9a7CIfUSBo6S", desc: "Distinct character voice with personality." },
    { name: "Dan", id: "Ioq2c1GJee5RyqeoBIH3", desc: "Casual male voice with natural pauses." },
    { name: "Natasha", id: "7lcjd4bgTyPW2qqLhV1Q", desc: "Clear female voice with confident delivery." },
    { name: "Rahul", id: "WtIqwF5CWCkaZSGmvsm1", desc: "Warm male voice with natural conversational tone." },
  ];

  // ✅ Pre-hosted MP3s (voiceId.mp3)
  const PREVIEW_BASE = "https://pub-178d4bb2cbf54f3f92bc03819410134c.r2.dev";

  // ==========================================================
  // ✅ AUTH (Memberstack) — HARDENED TOKEN + MEMBER DETECTION
  // ==========================================================
  let __nfTokenCache = { token: "", at: 0 };
  let __nfMemberCache = { member: null, at: 0 };

  function __nfIsJwtLike(t) {
    const s = String(t || "").trim();
    return s.split(".").length === 3 && s.length > 40;
  }

  function __nfPickTokenFromAny(obj) {
    // attempt a bunch of known shapes
    const cand = [
      obj?.data?.token,
      obj?.data?.accessToken,
      obj?.data?.jwt,
      obj?.data?.idToken,
      obj?.token,
      obj?.accessToken,
      obj?.jwt,
      obj?.idToken,
    ]
      .map((x) => (x == null ? "" : String(x).trim()))
      .find((x) => __nfIsJwtLike(x));

    return cand || "";
  }

  async function __nfSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function __nfWaitForMemberstack(maxMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (window.$memberstackDom) return true;
      await __nfSleep(50);
    }
    return false;
  }

  async function nfGetCurrentMemberSafe() {
    try {
      if (__nfMemberCache.member && Date.now() - __nfMemberCache.at < 10_000) {
        return __nfMemberCache.member;
      }
    } catch {}

    const msd = window.$memberstackDom;
    if (!msd || typeof msd.getCurrentMember !== "function") return null;

    try {
      // some installs expose onReady as a promise
      if (msd.onReady) {
        try {
          await msd.onReady;
        } catch {}
      }
    } catch {}

    try {
      const res = await msd.getCurrentMember();
      const member = res?.data || res || null;
      __nfMemberCache = { member, at: Date.now() };
      return member;
    } catch {
      return null;
    }
  }

  async function nfGetMsToken() {
    try {
      if (__nfTokenCache.token && Date.now() - __nfTokenCache.at < 30_000) {
        return __nfTokenCache.token;
      }
    } catch {}

    await __nfWaitForMemberstack(8000);

    const msd = window.$memberstackDom;
    if (!msd) return "";

    // Ensure ready
    try {
      if (msd.onReady) {
        try {
          await msd.onReady;
        } catch {}
      }
    } catch {}

    // Aggressive retries — MS sometimes returns empty token on first calls
    for (let attempt = 0; attempt < 25; attempt++) {
      // 1) getToken (most common)
      try {
        if (typeof msd.getToken === "function") {
          const r = await msd.getToken();
          const t = __nfPickTokenFromAny(r);
          if (t) {
            __nfTokenCache = { token: t, at: Date.now() };
            return t;
          }
        }
      } catch {}

      // 2) getMemberToken / getAuthToken (varies by install)
      try {
        if (typeof msd.getMemberToken === "function") {
          const r = await msd.getMemberToken();
          const t = __nfPickTokenFromAny(r);
          if (t) {
            __nfTokenCache = { token: t, at: Date.now() };
            return t;
          }
        }
      } catch {}

      try {
        if (typeof msd.getAuthToken === "function") {
          const r = await msd.getAuthToken();
          const t = __nfPickTokenFromAny(r);
          if (t) {
            __nfTokenCache = { token: t, at: Date.now() };
            return t;
          }
        }
      } catch {}

      // 3) If member exists, sometimes token becomes available right after
      await nfGetCurrentMemberSafe();

      // wait a bit and retry
      await __nfSleep(160);
    }

    return "";
  }

  async function nfAuthHeaders(extra) {
    const h = Object.assign({}, extra || {});
    const token = await nfGetMsToken();
    if (token) h.Authorization = "Bearer " + token;
    return h;
  }

  async function nfFetchJson(url, opts) {
    const res = await fetch(url, opts);
    const raw = await res.text().catch(() => "");
    let j = {};
    try {
      j = JSON.parse(raw);
    } catch {
      j = { raw };
    }
    return { res, raw, json: j };
  }

  // ==========================================================
  // ✅ MAIN APP
  // ==========================================================
  function boot() {
    // ---------- DOM ----------
    const msgEl = document.getElementById("rvMsg");
    const statusEl = document.getElementById("rvStatus");
    const barEl = document.getElementById("rvBar");
    const overlayEl = document.getElementById("rvOverlay");
    const videoEl = document.getElementById("rvVideo");

    const usernameEl = document.getElementById("rvUsername");
    const modeHidden = document.getElementById("rvMode");
    const postTitleEl = document.getElementById("rvPostTitle");
    const scriptEl = document.getElementById("rvScript");

    const postVoiceEl = document.getElementById("rvPostVoice");
    const scriptVoiceEl = document.getElementById("rvScriptVoice");
    const postVoiceLabel = document.getElementById("rvPostVoiceLabel");
    const scriptVoiceLabel = document.getElementById("rvScriptVoiceLabel");

    const voicesBtn = document.getElementById("rvVoicesBtn");

    const voiceModal = document.getElementById("rvVoiceModal");
    const voiceClose = document.getElementById("rvVoiceClose");
    const voiceTitle = document.getElementById("rvVoiceTitle");
    const voiceSearch = document.getElementById("rvVoiceSearch");
    const voiceClear = document.getElementById("rvVoiceClear");
    const voiceGrid = document.getElementById("rvVoiceGrid");
    const voiceTabs = document.getElementById("rvVoiceTabs");

    const likesEl = document.getElementById("rvLikes");
    const commentsEl = document.getElementById("rvComments");
    const shareTextEl = document.getElementById("rvShareText");

    const genBtn = document.getElementById("rvGenerate");
    const dlBtn = document.getElementById("rvDownload");

    const pfpUploadBtn = document.getElementById("rvPfpUploadBtn");
    const pfpFileEl = document.getElementById("rvPfpFile");
    const openPfpLibBtn = document.getElementById("rvOpenPfpLib");
    const openBgLibBtn = document.getElementById("rvOpenBgLib");
    const templatesBtn = document.getElementById("rvTemplatesBtn");
    const bgFileEl = document.getElementById("rvBgFile");
    const bgSelectedLine = document.getElementById("rvBgSelectedLine");
    const bgSelectedName = document.getElementById("rvBgSelectedName");

    const modeSeg = document.getElementById("rvModeSeg");
    const modeTrack = document.getElementById("rvModeTrack");

    const toneHidden = document.getElementById("rvTone");
    const lenHidden = document.getElementById("rvLen");

    const genScriptBtn = document.getElementById("rvGenScriptBtn");
    const scriptModal = document.getElementById("rvScriptModal");
    const scriptClose = document.getElementById("rvScriptClose");
    const scriptGenerate = document.getElementById("rvScriptGenerate");
    const scriptPromptEl = document.getElementById("rvScriptPrompt");

    const toneSegM = document.getElementById("rvToneSegModal");
    const toneTrackM = document.getElementById("rvToneTrackModal");
    const lenSegM = document.getElementById("rvLenSegModal");
    const lenTrackM = document.getElementById("rvLenTrackModal");

    const postTextEl = document.getElementById("rvPostText");
    const pfpUrlEl = document.getElementById("rvPfpUrl");

    // ---------- state ----------
    let localPfpObjectUrl = "";
    let localBgObjectUrl = "";
    let demoBgUrl = DEMO_GAMEPLAY_URL;

    let bgLibraryUrl = "";
    let bgLibraryName = "";

    let wrap = null,
      demoVid = null,
      card = null;
    let lastRenderDl = "",
      lastRenderName = "reddit-video";

    const REF_W = 1080;
    const REF_CARD_W = REF_W * 0.75; // 810

    function setMsg(t) {
      if (msgEl) msgEl.textContent = t || "—";
    }
    function setStatus(t) {
      if (statusEl) statusEl.textContent = t || "—";
      setMsg(t);
    }
    function setProgress(pct) {
      const v = Math.max(0, Math.min(100, Number(pct) || 0));
      if (barEl) barEl.style.width = v + "%";
    }

    function safeFilename(title) {
      const safe = String(title || "reddit_video")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      return (safe || "reddit_video") + ".mp4";
    }
    function downloadProxyUrl(videoUrl, filename) {
      return `${API_BASE}/api/download?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(filename)}`;
    }
    function setDownloadEnabled(enabled) {
      if (!dlBtn) return;
      dlBtn.disabled = !enabled;
      dlBtn.style.opacity = enabled ? "1" : ".65";
      dlBtn.style.cursor = enabled ? "pointer" : "not-allowed";
    }
    setDownloadEnabled(false);

    function readAnyText(el) {
      if (!el) return "";
      if (typeof el.value === "string") return el.value;
      return el.textContent || "";
    }

    function findPreviewHost() {
      if (!videoEl) return null;
      let el = videoEl.parentElement;
      for (let i = 0; i < 7 && el; i++) {
        const cs = getComputedStyle(el);
        const br = parseFloat(cs.borderTopLeftRadius || "0") || 0;
        const oh =
          (cs.overflow || "").includes("hidden") ||
          (cs.overflowY || "").includes("hidden") ||
          (cs.overflowX || "").includes("hidden");
        if ((br >= 10 && oh) || (oh && el.clientHeight > 200)) return el;
        el = el.parentElement;
      }
      return videoEl.parentElement;
    }

    // ---------- ✅ upload helpers ----------
    async function getSignedUploadUrl(file) {
      const payload = {
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type || "application/octet-stream",
      };

      const token = await nfGetMsToken();
      if (!token) throw new Error("Not logged in (missing Memberstack token). Please refresh + log in again.");

      const { res, json } = await nfFetchJson(SIGNED_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: await nfAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      if (!res.ok || json?.error) {
        throw new Error(json?.error || json?.message || json?.raw || "Signed upload failed (HTTP " + res.status + ")");
      }
      if (!json?.signedUrl || !json?.bucket || !json?.path) {
        throw new Error("Signed upload response missing signedUrl/bucket/path.");
      }
      return json;
    }

    async function putFileToSignedUrl(signedUrl, file) {
      const res = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error("Upload PUT failed (HTTP " + res.status + ") " + (t || ""));
      }
    }

    function publicUrlFromSigned(bucket, path, signedUrl) {
      const base = String(signedUrl).split("/storage/v1/")[0];
      return `${base}/storage/v1/object/public/${bucket}/${path}`;
    }

    async function uploadAndGetPublicUrl(file) {
      const signed = await getSignedUploadUrl(file);
      await putFileToSignedUrl(signed.signedUrl, file);
      const url = publicUrlFromSigned(signed.bucket, signed.path, signed.signedUrl);
      return { url, bucket: signed.bucket, path: signed.path };
    }

    // ---------- inject CSS for preview ----------
    (function injectCss() {
      const id = "nfRvCssV11";
      if (document.getElementById(id)) return;
      const s = document.createElement("style");
      s.id = id;
      s.textContent = `
        .nf-rvWrap{ position:absolute; inset:0; z-index:5000; display:block; pointer-events:none; }
        .nf-rvCard{ pointer-events:none; }
        .nf-rvDemoVideo{ pointer-events:auto; }
        .nf-rvDemoVideo{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center; background:#000; display:block; }
        .nf-rvCard{
          position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
          width: var(--cardW);
          height:auto; min-height: var(--cardMinH); max-height: var(--cardMaxH);
          border-radius: calc(30px * var(--scale));
          overflow:hidden;
          box-shadow: 0 18px 55px rgba(0,0,0,.35);
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial;
          box-sizing:border-box;
          display:grid; grid-template-rows: auto 1fr auto;
          padding: calc(24px * var(--scale));
          gap: calc(12px * var(--scale));
        }
        .nf-rvCard.light{ background:#fff; color:#0A0E1A; }
        .nf-rvCard.dark{ background:#000; color:#fff; }

        .nf-rvHeader{ display:flex; gap: calc(18px * var(--scale)); align-items:flex-start; min-width:0; }
        .nf-rvPfp{ width: calc(72px * var(--scale)); height: calc(72px * var(--scale)); border-radius:999vmin; overflow:hidden; flex:0 0 auto; background:#ddd; }
        .nf-rvPfp img{ width:100%; height:100%; object-fit:cover; display:block; }
        .nf-rvHeaderText{ flex:1 1 auto; min-width:0; }
        .nf-rvUsername{ font-weight:600; font-size: calc(34px * var(--scale)); line-height:1.05; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .nf-rvFlairs{ margin-top: calc(6px * var(--scale)); display:flex; gap: calc(6px * var(--scale)); align-items:center; flex-wrap:nowrap; overflow:hidden; }
        .nf-rvFlairs img{ height: calc(24px * var(--scale)); width:auto; display:block; }
        .nf-rvBody{ font-weight:600; font-size: calc(29.7px * var(--scale)); line-height:1.35; white-space:pre-wrap; overflow:hidden; word-break: break-word; }
        .nf-rvFooter{
          display:flex; align-items:flex-end; justify-content:space-between;
          gap: calc(14px * var(--scale));
          color: rgba(180,176,176,1);
          padding-top: calc(2px * var(--scale)); padding-bottom: 0;
        }
        .nf-rvLeftActions{ display:flex; align-items:center; gap: calc(22px * var(--scale)); }
        .nf-rvAction{ display:flex; align-items:center; gap: calc(10px * var(--scale)); font-weight:400; font-size: calc(31px * var(--scale)); line-height:1; white-space:nowrap; }
        .nf-rvIcon{ width: calc(24px * var(--scale)); height: calc(24px * var(--scale)); display:block; opacity:0.95; }
        .nf-rvShare{ display:flex; align-items:center; gap: calc(10px * var(--scale)); font-weight:500; font-size: calc(29px * var(--scale)); white-space:nowrap; }
        .nf-rvIconHeart{ stroke: currentColor; stroke-width: 6; fill: none; stroke-linejoin: round; }
        .nf-rvOverlayHideText{ color: transparent !important; }
      `;
      document.head.appendChild(s);
    })();

    // ---------- ✅ Voice picker CSS ----------
    (function injectVoiceCss() {
      const id = "nfVoicePickerCssV4";
      if (document.getElementById(id)) return;
      const s = document.createElement("style");
      s.id = id;
      s.textContent = `
        .nf-voiceTabs{ display:flex; gap:8px; margin: 2px 0 12px; }
        .nf-voiceTab{
          border:1px solid rgba(255,255,255,.14);
          background: rgba(255,255,255,.06);
          color: rgba(255,255,255,.85);
          border-radius: 999px;
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          line-height: 1;
        }
        .nf-voiceTab.active{
          border-color: rgba(90,193,255,.45);
          background: rgba(90,193,255,.18);
          color: rgba(90,193,255,1);
        }
        .nf-voiceGrid{ display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; }
        @media (max-width: 900px){ .nf-voiceGrid{ grid-template-columns: repeat(2, 1fr);} }
        @media (max-width: 620px){ .nf-voiceGrid{ grid-template-columns: 1fr;} }
        .nf-voiceCard{
          border:1px solid rgba(255,255,255,.12);
          background: rgba(255,255,255,.05);
          border-radius:18px;
          padding:18px;
          display:flex;
          flex-direction:column;
          gap:14px;
          min-height: 148px;
          transition:border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
          position: relative;
        }
        .nf-voiceCard:hover{
          border-color: rgba(90,193,255,.45);
          box-shadow: 0 0 0 1px rgba(90,193,255,.18) inset;
          transform: translateY(-1px);
        }
        .nf-voiceSelected{
          border-color: rgba(90,193,255,.65) !important;
          box-shadow: 0 0 0 1px rgba(90,193,255,.22) inset;
        }
        .nf-voiceName{ font-weight:950; font-size:16px; margin-bottom:6px; }
        .nf-voiceDesc{
          font-size:13px;
          color: rgba(255,255,255,.68);
          line-height:1.35;
          white-space: normal;
          word-break: break-word;
        }
        .nf-voiceBtnsRow{ margin-top:auto; display:flex; gap:14px; }
        .nf-voiceBtnMini{
          flex:1 1 0;
          border:1px solid rgba(255,255,255,.16);
          background: rgba(255,255,255,.08);
          color: rgba(255,255,255,.92);
          border-radius: 18px;
          height: 44px;
          padding: 0 14px;
          font-size: 14px;
          font-weight: 900;
          display:flex;
          align-items:center;
          justify-content:center;
          line-height: 1;
          cursor:pointer;
          white-space:nowrap;
          text-align:center;
        }
        .nf-voiceBtnMini:disabled{ opacity:.72; cursor:not-allowed; }
        .nf-voiceBtnUse{
          border-color: rgba(90,193,255,.35);
          background: rgba(90,193,255,.16);
          color: rgba(90,193,255,1);
        }
        #rvPostVoiceLabel, #rvScriptVoiceLabel{ display:none !important; }
      `;
      document.head.appendChild(s);
    })();

    // ---------- icons ----------
    const PATH_LIKE = `M 50 100 L 7.5578 50.9275 C 2.6844 45.2929 0 37.8006 0 29.833 C 0 21.8641 2.6844 14.3731 7.5578 8.7384 C 12.4311 3.1038 18.91 0 25.8022 0 C 32.6944 0 39.1733 3.1038 44.0467 8.7384 L 50 15.6218 L 55.9533 8.7384 C 60.8267 3.1038 67.3067 0 74.1978 0 C 81.09 0 87.5689 3.1038 92.4422 8.7384 C 97.3167 14.3731 100 21.8641 100 29.833 C 100 37.8019 97.3167 45.2929 92.4422 50.9275 L 50 100 Z M 25.8022 5.1387 C 20.0978 5.1387 14.7344 7.7081 10.7 12.3715 C 6.6656 17.0349 4.4444 23.2374 4.4444 29.833 C 4.4444 36.4286 6.6667 42.6298 10.7 47.2945 L 50 92.7338 L 89.3 47.2945 C 93.3344 42.6298 95.5556 36.4286 95.5556 29.833 C 95.5556 23.2374 93.3344 17.0362 89.3 12.3715 C 85.2656 7.7081 79.9033 5.1387 74.1978 5.1387 C 68.4933 5.1387 63.13 7.7081 59.0956 12.3715 L 50 22.8893 L 40.9033 12.3715 C 36.87 7.7081 31.5067 5.1387 25.8022 5.1387 Z`;
    const PATH_COMMENT = `M 94.2357 72.6204 C 97.8532 65.5833 99.7431 57.786 99.7491 49.8735 C 99.7491 22.3751 77.3736 0 49.8745 0 C 22.3755 0 0 22.3751 0 49.8735 C 0 77.372 22.3755 99.7471 49.8745 99.7471 C 57.7729 99.7471 65.5986 97.8473 72.6264 94.2383 L 94.1178 99.611 C 95.662 100 97.2969 99.5469 98.4206 98.4186 C 99.5473 97.2921 100 95.6569 99.6131 94.1114 L 94.2357 72.6204 Z M 85.018 73.1191 L 88.9807 88.9789 L 73.1206 85.0117 C 71.9994 84.7349 70.8149 84.8937 69.8062 85.456 C 63.7193 88.8753 56.8561 90.6738 49.8745 90.6792 C 27.3721 90.6792 9.0681 72.371 9.0681 49.8735 C 9.0681 27.376 27.3721 9.0679 49.8745 9.0679 C 72.377 9.0679 90.681 27.376 90.681 49.8735 C 90.6748 56.8528 88.8779 63.7138 85.4623 69.8003 C 84.8939 70.8086 84.7348 71.9968 85.018 73.1191 Z`;
    const PATH_SHARE = `M 33.55 28.6214 L 45 17.1329 L 45 65.035 C 45 67.7918 47.2404 70.03 50 70.03 C 52.7596 70.03 55 67.7918 55 65.035 L 55 17.1329 L 66.45 28.6214 C 67.3888 29.5671 68.6668 30.099 70 30.099 C 71.3332 30.099 72.6112 29.5671 73.55 28.6214 C 74.4966 27.6835 75.029 26.4068 75.029 25.075 C 75.029 23.7431 74.4966 22.4664 73.55 21.5285 L 53.55 1.5485 C 53.55 1.5485 52.5138 0.7373 51.9 0.4996 C 50.6827 0 49.3173 0 48.1 0.4996 C 47.4862 0.7373 46.45 1.5485 46.45 1.5485 L 26.45 21.5285 C 24.4907 23.4859 24.4907 26.6641 26.45 28.6214 C 28.4093 30.5788 31.5907 30.5788 33.55 28.6214 Z M 95 50.05 C 92.2404 50.05 90 52.2882 90 55.045 L 90 85.015 C 90 87.7718 87.7596 90.01 85 90.01 L 15 90.01 C 12.2404 90.01 10 87.7718 10 85.015 L 10 55.045 C 10 52.2882 7.7596 50.05 5 50.05 C 2.2404 50.05 0 52.2882 0 55.045 L 0 85.015 C 0 93.2854 6.7213 100 15 100 L 85 100 C 93.2787 100 100 93.2854 100 85.015 L 100 55.045 C 100 52.2882 97.7596 50.05 95 50.05 Z`;

    // ==========================================================
    // ✅ Voice options helpers (READ from localStorage)
    // ==========================================================
    const NF_DEFAULT_SPEED = 1.0;
    const NF_DEFAULT_VOL = 1.0;

    function nfClamp(n, a, b) {
      n = Number(n);
      if (!Number.isFinite(n)) return a;
      return Math.max(a, Math.min(b, n));
    }

    function nfNormalizeMode(m) {
      const s = String(m || "").toLowerCase().trim();
      return s === "script" ? "script" : "post";
    }

    function nfGetVoiceOpts(mode, voiceId) {
      const m = nfNormalizeMode(mode);
      const id = String(voiceId || "").trim();
      if (!id || id.toLowerCase() === "default") return { speed: NF_DEFAULT_SPEED, volume: NF_DEFAULT_VOL };

      try {
        const key = `nf_voice_opts_v1:${m}:${id}`;
        const raw = localStorage.getItem(key);
        if (!raw) return { speed: NF_DEFAULT_SPEED, volume: NF_DEFAULT_VOL };
        const o = JSON.parse(raw);
        return {
          speed: nfClamp(o.speed ?? NF_DEFAULT_SPEED, 0.5, 2.0),
          volume: nfClamp(o.volume ?? NF_DEFAULT_VOL, 0.0, 1.5),
        };
      } catch {
        return { speed: NF_DEFAULT_SPEED, volume: NF_DEFAULT_VOL };
      }
    }

    window.nfGetVoiceOpts = window.nfGetVoiceOpts || nfGetVoiceOpts;

    function ensureNodes() {
      const host = findPreviewHost();
      if (!host) return;

      const hs = getComputedStyle(host);
      if (hs.position === "static") host.style.position = "relative";

      wrap = document.getElementById("nfRvWrapV11");
      if (!wrap) {
        wrap = document.createElement("div");
        wrap.id = "nfRvWrapV11";
        wrap.className = "nf-rvWrap";
        host.appendChild(wrap);
      }

      demoVid = document.getElementById("nfRvDemoVidV11");
      if (!demoVid) {
        demoVid = document.createElement("video");
        demoVid.id = "nfRvDemoVidV11";
        demoVid.className = "nf-rvDemoVideo";
        demoVid.autoplay = true;
        demoVid.loop = true;
        demoVid.playsInline = true;
        demoVid.preload = "metadata";
        demoVid.muted = true;
        demoVid.controls = true;
        wrap.appendChild(demoVid);
      }

      card = document.getElementById("nfRvCardV11");
      if (!card) {
        card = document.createElement("div");
        card.id = "nfRvCardV11";
        card.className = "nf-rvCard light";
        card.innerHTML = `
          <div class="nf-rvHeader">
            <div class="nf-rvPfp"><img id="nfRvPfpImgV11" alt=""></div>
            <div class="nf-rvHeaderText">
              <div class="nf-rvUsername" id="nfRvUsernameV11">Nofacelabs.ai</div>
              <div class="nf-rvFlairs" id="nfRvFlairsV11"></div>
            </div>
          </div>

          <div class="nf-rvBody" id="nfRvBodyV11">—</div>

          <div class="nf-rvFooter">
            <div class="nf-rvLeftActions">
              <div class="nf-rvAction">
                <svg class="nf-rvIcon nf-rvIconHeart" viewBox="0 0 100 100" aria-hidden="true">
                  <path d="${PATH_LIKE}"></path>
                </svg>
                <span id="nfRvLikesV11">99+</span>
              </div>

              <div class="nf-rvAction">
                <svg class="nf-rvIcon" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
                  <path d="${PATH_COMMENT}"></path>
                </svg>
                <span id="nfRvCommentsV11">99+</span>
              </div>
            </div>

            <div class="nf-rvShare">
              <svg class="nf-rvIcon" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
                <path d="${PATH_SHARE}"></path>
              </svg>
              <span id="nfRvShareV11">share</span>
            </div>
          </div>
        `;
        wrap.appendChild(card);
      }

      if (overlayEl) overlayEl.classList.add("nf-rvOverlayHideText");
      resizeCard();
    }

    function resizeCard() {
      const host = findPreviewHost();
      if (!host || !card) return;

      const frameW = host.clientWidth || 1;
      const frameH = host.clientHeight || 1;

      const cardW = Math.round(frameW * 0.8);
      const minH = Math.round(frameH * 0.215);
      const maxH = Math.round(frameH * 0.62);

      const scaleW = cardW / (REF_CARD_W || 1);
      let scale = scaleW * 0.9;
      scale = Math.max(0.45, Math.min(1.25, scale));

      card.style.setProperty("--cardW", cardW + "px");
      card.style.setProperty("--cardMinH", minH + "px");
      card.style.setProperty("--cardMaxH", maxH + "px");
      card.style.setProperty("--scale", String(scale));
    }

    let __t = null;
    window.addEventListener("resize", () => {
      clearTimeout(__t);
      __t = setTimeout(() => {
        resizeCard();
        updateCard();
      }, 120);
    });

    function setFlairs() {
      const el = document.getElementById("nfRvFlairsV11");
      if (!el) return;
      el.innerHTML = (FLAIRS || []).map((u) => `<img src="${u}" alt="">`).join("");
    }

    function getBodyText() {
      const title = String(readAnyText(postTitleEl)).trim();
      const post = String(readAnyText(postTextEl)).trim();
      return post || title || "—";
    }

    function getPostTextForPayload() {
      const title = String(readAnyText(postTitleEl)).trim();
      const post = String(readAnyText(postTextEl)).trim();
      return post || title || "";
    }

    function getPfpUrl() {
      const fromInput = String(readAnyText(pfpUrlEl)).trim();
      return fromInput || localPfpObjectUrl || DEFAULT_PFP_URL;
    }

    function updateCard() {
      ensureNodes();
      resizeCard();

      const mode = String(modeHidden?.value || "light").toLowerCase() === "dark" ? "dark" : "light";
      card.classList.remove("light", "dark");
      card.classList.add(mode);

      const username = String(readAnyText(usernameEl)).trim() || "Nofacelabs.ai";
      const likes = String(readAnyText(likesEl)).trim() || "99+";
      const comments = String(readAnyText(commentsEl)).trim() || "99+";
      const share = String(readAnyText(shareTextEl)).trim() || "share";

      const bodyText = getBodyText();
      const pfpUrl = getPfpUrl();

      const u = document.getElementById("nfRvUsernameV11");
      const b = document.getElementById("nfRvBodyV11");
      const l = document.getElementById("nfRvLikesV11");
      const c = document.getElementById("nfRvCommentsV11");
      const sh = document.getElementById("nfRvShareV11");
      const p = document.getElementById("nfRvPfpImgV11");

      if (u) u.textContent = username;
      if (b) b.textContent = bodyText;
      if (l) l.textContent = likes;
      if (c) c.textContent = comments;
      if (sh) sh.textContent = share;
      if (p && p.src !== pfpUrl) p.src = pfpUrl;

      setFlairs();
      requestAnimationFrame(() => resizeCard());
    }

    function showDemo() {
      ensureNodes();
      if (wrap) wrap.style.display = "block";
      if (demoVid && demoVid.src !== demoBgUrl) {
        demoVid.src = demoBgUrl;
        demoVid.load?.();
        demoVid.play?.().catch(() => {});
      }
      updateCard();

      if (videoEl) {
        videoEl.classList.add("nf-hide");
        videoEl.style.display = "none";
        try {
          videoEl.pause?.();
        } catch {}
      }
    }
    function hideDemo() {
      if (wrap) wrap.style.display = "none";
    }

    function showRender(url) {
      hideDemo();
      if (overlayEl) overlayEl.classList.add("nf-hide");
      if (videoEl) {
        videoEl.src = url;
        videoEl.load?.();
        videoEl.classList.remove("nf-hide");
        videoEl.style.display = "block";
        videoEl.play?.().catch(() => {});
      }
    }

    function setupSeg(segEl, trackEl, hiddenEl, dataKey) {
      if (!segEl) return;
      const btns = Array.from(segEl.querySelectorAll(".nf-segBtn"));
      if (!btns.length) return;

      function setActiveByIndex(idx) {
        btns.forEach((b) => b.classList.remove("active"));
        btns[idx].classList.add("active");
        if (trackEl) trackEl.style.transform = `translateX(${idx * 100}%)`;
      }

      if (hiddenEl) {
        const v = String(hiddenEl.value || "").toLowerCase();
        const idx = btns.findIndex((b) => String(b.dataset[dataKey] || "").toLowerCase() === v);
        if (idx >= 0) setActiveByIndex(idx);
        else setActiveByIndex(Math.max(0, btns.findIndex((b) => b.classList.contains("active"))));
      } else {
        setActiveByIndex(Math.max(0, btns.findIndex((b) => b.classList.contains("active"))));
      }

      segEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".nf-segBtn");
        if (!btn) return;
        const idx = btns.indexOf(btn);
        if (idx < 0) return;

        const val = btn.dataset[dataKey];
        if (hiddenEl && typeof val !== "undefined") hiddenEl.value = val;

        setActiveByIndex(idx);
        updateCard();
      });
    }

    setupSeg(modeSeg, modeTrack, modeHidden, "mode");

    // ==========================
    // ✅ SCRIPT GENERATOR MODAL
    // ==========================
    function setupModalSeg(segEl, trackEl, hiddenEl, dataKey) {
      if (!segEl) return;
      const btns = Array.from(segEl.querySelectorAll(".nf-segBtn"));
      if (!btns.length) return;

      function setActive(idx) {
        btns.forEach((b) => b.classList.remove("active"));
        btns[idx].classList.add("active");
        if (trackEl) trackEl.style.transform = `translateX(${idx * 100}%)`;
        const val = btns[idx].dataset[dataKey];
        if (hiddenEl && typeof val !== "undefined") hiddenEl.value = val;
      }

      const cur = String(hiddenEl?.value || "").toLowerCase();
      const idx = btns.findIndex((b) => String(b.dataset[dataKey] || "").toLowerCase() === cur);
      setActive(idx >= 0 ? idx : 0);

      segEl.addEventListener("click", (e) => {
        const btn = e.target.closest(".nf-segBtn");
        if (!btn) return;
        const i = btns.indexOf(btn);
        if (i >= 0) setActive(i);
      });
    }

    setupModalSeg(toneSegM, toneTrackM, toneHidden, "tone");
    setupModalSeg(lenSegM, lenTrackM, lenHidden, "len");

    function openScriptModal() {
      if (!scriptModal) return;
      const title = String(readAnyText(postTitleEl) || "").trim();
      if (scriptPromptEl && !String(scriptPromptEl.value || "").trim()) {
        scriptPromptEl.value = title;
      }
      scriptModal.classList.add("open");
      setTimeout(() => {
        try {
          scriptPromptEl?.focus?.();
          scriptPromptEl?.setSelectionRange?.(scriptPromptEl.value.length, scriptPromptEl.value.length);
        } catch {}
      }, 50);
    }

    function closeScriptModal() {
      if (!scriptModal) return;
      scriptModal.classList.remove("open");
    }

    function setMainScriptBtnLoading(isLoading) {
      if (!genScriptBtn) return;
      if (isLoading) {
        genScriptBtn.dataset._oldHtml = genScriptBtn.innerHTML;
        genScriptBtn.disabled = true;
        genScriptBtn.style.opacity = ".85";
        genScriptBtn.textContent = "Generating...";
      } else {
        genScriptBtn.disabled = false;
        genScriptBtn.style.opacity = "1";
        genScriptBtn.innerHTML = genScriptBtn.dataset._oldHtml || "✨ Generate script";
        delete genScriptBtn.dataset._oldHtml;
      }
    }

    if (genScriptBtn) genScriptBtn.addEventListener("click", openScriptModal);
    if (scriptClose) scriptClose.addEventListener("click", closeScriptModal);
    if (scriptModal) {
      scriptModal.addEventListener("click", (e) => {
        if (e.target === scriptModal) closeScriptModal();
      });
    }

    if (scriptPromptEl) {
      scriptPromptEl.addEventListener("keydown", (e) => {
        const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
        const mod = isMac ? e.metaKey : e.ctrlKey;
        if (mod && e.key === "Enter") {
          e.preventDefault();
          scriptGenerate?.click?.();
        }
      });
    }

    async function generateScriptFromPrompt() {
      const topic = String(readAnyText(scriptPromptEl) || "").trim();
      const tone = String(readAnyText(toneHidden) || "funny").trim();
      const seconds = Number(readAnyText(lenHidden) || 45) || 45;

      if (!topic) throw new Error("Please enter a prompt.");

      closeScriptModal();
      setMainScriptBtnLoading(true);
      if (scriptGenerate) scriptGenerate.disabled = true;

      const { res, json } = await nfFetchJson(SCRIPT_ENDPOINT, {
        method: "POST",
        headers: await nfAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ topic, tone, seconds }),
      });

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || json?.message || json?.raw || "HTTP " + res.status);
      }

      const out = String(json?.script || "").trim();
      if (!out) throw new Error("No script returned.");

      if (scriptEl) scriptEl.value = out;
      updateCard();
    }

    if (scriptGenerate) {
      scriptGenerate.addEventListener("click", async () => {
        try {
          await generateScriptFromPrompt();
        } catch (e) {
          console.error("[rv] script gen failed =>", e);
          alert("Script generation failed: " + (e?.message || e));
          openScriptModal();
        } finally {
          if (scriptGenerate) scriptGenerate.disabled = false;
          setMainScriptBtnLoading(false);
        }
      });
    }

    // Upload PFP button click
    if (pfpUploadBtn && pfpFileEl) pfpUploadBtn.addEventListener("click", () => pfpFileEl.click());

    if (pfpFileEl) {
      pfpFileEl.addEventListener("change", async () => {
        const file = pfpFileEl.files?.[0];
        if (!file) return;

        if (localPfpObjectUrl) {
          try {
            URL.revokeObjectURL(localPfpObjectUrl);
          } catch {}
        }
        localPfpObjectUrl = URL.createObjectURL(file);
        updateCard();
        setStatus("Uploading profile picture…");

        try {
          const up = await uploadAndGetPublicUrl(file);
          if (pfpUrlEl) pfpUrlEl.value = up.url;

          try {
            URL.revokeObjectURL(localPfpObjectUrl);
          } catch {}
          localPfpObjectUrl = "";

          setStatus("Profile picture uploaded ✓");
          updateCard();
        } catch (e) {
          console.error("[rv] pfp upload failed =>", e);
          setStatus("PFP upload failed: " + (e?.message || e));
          alert("PFP upload failed: " + (e?.message || e));
          updateCard();
        }
      });
    }

    function fire(name, detail) {
      window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    }
    if (openPfpLibBtn) openPfpLibBtn.addEventListener("click", () => fire("nf:rv:openPfpLibrary"));
    if (openBgLibBtn) openBgLibBtn.addEventListener("click", () => fire("nf:rv:openBgLibrary"));
    if (templatesBtn) templatesBtn.addEventListener("click", () => fire("nf:rv:openTemplates"));

    window.addEventListener("nf:rv:setPfp", (e) => {
      const url = String(e?.detail?.url || "").trim();
      if (!url) return;
      if (pfpUrlEl) pfpUrlEl.value = url;
      localPfpObjectUrl = "";
      updateCard();
    });

    if (bgFileEl) {
      bgFileEl.addEventListener("change", async () => {
        const file = bgFileEl.files?.[0];
        if (!file) return;

        if (localBgObjectUrl) {
          try {
            URL.revokeObjectURL(localBgObjectUrl);
          } catch {}
        }
        localBgObjectUrl = URL.createObjectURL(file);
        demoBgUrl = localBgObjectUrl;

        if (bgSelectedLine && bgSelectedName) {
          bgSelectedLine.style.display = "block";
          bgSelectedName.textContent = (file.name || "Uploaded video") + " (uploading…)";
        }

        showDemo();
        setStatus("Uploading background video…");

        try {
          const up = await uploadAndGetPublicUrl(file);

          bgLibraryUrl = up.url;
          bgLibraryName = file.name || "Uploaded video";
          demoBgUrl = bgLibraryUrl;

          if (bgSelectedLine && bgSelectedName) {
            bgSelectedLine.style.display = "block";
            bgSelectedName.textContent = bgLibraryName + " ✓";
          }

          setStatus("Background uploaded ✓ (ready to render)");
          showDemo();
        } catch (e) {
          console.error("[rv] bg upload failed =>", e);
          setStatus("BG upload failed: " + (e?.message || e));
          alert("BG upload failed: " + (e?.message || e));

          bgLibraryUrl = "";
          bgLibraryName = "";
          demoBgUrl = localBgObjectUrl;

          if (bgSelectedLine && bgSelectedName) {
            bgSelectedName.textContent = (file.name || "Uploaded video") + " (preview only)";
          }
          showDemo();
        }
      });
    }

    window.addEventListener("nf:rv:setBackground", (e) => {
      const url = String(e?.detail?.url || "").trim();
      const name = String(e?.detail?.name || "").trim();
      if (!url) return;

      bgLibraryUrl = url;
      bgLibraryName = name || "Library video";
      demoBgUrl = url;

      if (bgSelectedLine && bgSelectedName) {
        bgSelectedLine.style.display = "block";
        bgSelectedName.textContent = bgLibraryName;
      }
      showDemo();
      setStatus("Background ready ✓");
    });

    function bindRealtime(el) {
      if (!el) return;
      el.addEventListener("input", updateCard);
      el.addEventListener("change", updateCard);
      el.addEventListener("keyup", updateCard);
    }
    [usernameEl, postTitleEl, postTextEl, likesEl, commentsEl, shareTextEl, modeHidden].forEach(bindRealtime);

    // ==========================================================
    // ✅ VOICE PICKER (same behavior)
    // ==========================================================
    let voiceTarget = "post";
    let previewAudio = null;
    let previewingVoiceId = "";
    const PREVIEW_AUDIO_CACHE = new Map();

    function previewUrlFor(voiceId) {
      return PREVIEW_BASE
        ? PREVIEW_BASE.replace(/\/$/, "") + "/" + encodeURIComponent(voiceId) + ".mp3"
        : "";
    }
    function preloadPreview(voiceId) {
      if (!PREVIEW_BASE) return;
      if (!voiceId) return;
      if (PREVIEW_AUDIO_CACHE.has(voiceId)) return;
      const url = previewUrlFor(voiceId);
      if (!url) return;
      const a = new Audio();
      a.src = url;
      a.preload = "auto";
      a.load();
      PREVIEW_AUDIO_CACHE.set(voiceId, a);
    }
    function warmPreviews() {
      if (!PREVIEW_BASE) return;
      VOICES.slice(0, 10).forEach((v) => preloadPreview(v.id));
      const curPost = String(postVoiceEl?.value || "").trim();
      const curScr = String(scriptVoiceEl?.value || "").trim();
      if (curPost && curPost !== "default") preloadPreview(curPost);
      if (curScr && curScr !== "default") preloadPreview(curScr);
    }

    (function installAudioUnlock() {
      const handler = () => {
        try {
          const a = new Audio();
          a.muted = true;
          a.play().catch(() => {});
        } catch {}
        document.removeEventListener("pointerdown", handler, true);
        document.removeEventListener("touchstart", handler, true);
        document.removeEventListener("click", handler, true);
      };
      document.addEventListener("pointerdown", handler, true);
      document.addEventListener("touchstart", handler, true);
      document.addEventListener("click", handler, true);
    })();

    function stopPreview() {
      if (previewAudio) {
        try {
          previewAudio.pause();
          previewAudio.currentTime = 0;
        } catch {}
      }
      previewingVoiceId = "";
      previewAudio = null;
    }

    function findVoiceById(id) {
      const s = String(id || "").trim();
      if (!s || s === "default") return null;
      return VOICES.find((v) => v.id === s) || null;
    }

    function getSelectedVoiceId(target) {
      const el = target === "script" ? scriptVoiceEl : postVoiceEl;
      return String(el?.value || "default").trim();
    }

    function setSelectedVoice(target, voice) {
      const el = target === "script" ? scriptVoiceEl : postVoiceEl;
      const labelEl = target === "script" ? scriptVoiceLabel : postVoiceLabel;

      if (el) el.value = voice?.id || "default";
      if (labelEl) labelEl.textContent = voice?.name || "Default";

      if (voice?.id) preloadPreview(voice.id);
      renderVoiceGrid(String(voiceSearch?.value || "").trim());
    }

    function setActiveTab(tab) {
      voiceTarget = tab === "script" ? "script" : "post";
      window.__NF_ACTIVE_VOICE_MODE__ = voiceTarget;
      stopPreview();
      renderVoiceGrid(String(voiceSearch?.value || "").trim());

      if (voiceTitle) voiceTitle.textContent = voiceTarget === "post" ? "Choose Post Voice" : "Choose Script Voice";

      const postBtn = voiceTabs?.querySelector('[data-tab="post"]');
      const scrBtn = voiceTabs?.querySelector('[data-tab="script"]');
      if (postBtn) postBtn.classList.toggle("active", voiceTarget === "post");
      if (scrBtn) scrBtn.classList.toggle("active", voiceTarget === "script");
    }

    async function previewVoice(voice) {
      stopPreview();
      const voiceId = String(voice?.id || "").trim();
      if (!voiceId) return alert("Missing voice id");

      previewingVoiceId = voiceId;
      renderVoiceGrid(String(voiceSearch?.value || "").trim());

      preloadPreview(voiceId);
      const a = PREVIEW_AUDIO_CACHE.get(voiceId);
      if (!a) {
        previewingVoiceId = "";
        renderVoiceGrid(String(voiceSearch?.value || "").trim());
        alert("Preview missing. Make sure your bucket has: " + voiceId + ".mp3");
        return;
      }

      previewAudio = a;
      try {
        previewAudio.currentTime = 0;
      } catch {}

      previewAudio.onended = () => {
        stopPreview();
        renderVoiceGrid(String(voiceSearch?.value || "").trim());
      };

      previewAudio.play().catch(() => {
        stopPreview();
        renderVoiceGrid(String(voiceSearch?.value || "").trim());
        alert("Audio is blocked. Tap/click once on the page, then try Preview again.");
      });
    }

    function escAttr(s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function renderVoiceGrid(q) {
      if (!voiceGrid) return;

      const query = String(q || "").toLowerCase().trim();
      const selectedId = getSelectedVoiceId(voiceTarget);

      const filtered = VOICES.filter((v) => {
        if (!query) return true;
        return (
          v.name.toLowerCase().includes(query) ||
          String(v.desc || "").toLowerCase().includes(query) ||
          v.id.toLowerCase().includes(query)
        );
      });

      voiceGrid.classList.add("nf-voiceGrid");

      voiceGrid.innerHTML = filtered
        .map((v) => {
          const selected = selectedId === v.id;
          const isPreviewing = previewingVoiceId === v.id;

          return `
            <div class="nf-voiceCard ${selected ? "nf-voiceSelected" : ""}"
              data-voice-id="${escAttr(v.id)}"
              data-voice-name="${escAttr(v.name)}">
              <div style="min-width:0;">
                <div class="nf-voiceName" title="${escAttr(v.name)}">${escAttr(v.name)}</div>
                <div class="nf-voiceDesc" title="${escAttr(v.desc || "")}">${escAttr(v.desc || "—")}</div>
              </div>

              <div class="nf-voiceBtnsRow">
                <button class="nf-voiceBtnMini" type="button" data-act="preview" data-id="${escAttr(v.id)}" ${isPreviewing ? "disabled" : ""}>
                  ${isPreviewing ? "Previewing..." : "Preview"}
                </button>
                <button class="nf-voiceBtnMini nf-voiceBtnUse" type="button" data-act="use" data-id="${escAttr(v.id)}">
                  ${selected ? "Selected" : "Use voice"}
                </button>
              </div>
            </div>
          `;
        })
        .join("");
    }

    function openVoiceModal() {
      window.__NF_ACTIVE_VOICE_MODE__ = voiceTarget;
      if (voiceSearch) voiceSearch.value = "";
      if (voiceModal) voiceModal.classList.add("open");
      setActiveTab(voiceTarget);
      renderVoiceGrid("");
      warmPreviews();
    }

    function closeVoiceModal() {
      if (voiceModal) voiceModal.classList.remove("open");
      stopPreview();
      renderVoiceGrid(String(voiceSearch?.value || "").trim());
    }

    if (voicesBtn) voicesBtn.addEventListener("click", openVoiceModal);

    if (voiceTabs) {
      voiceTabs.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-tab]");
        if (!b) return;
        setActiveTab(b.dataset.tab);
      });
    }

    if (voiceClose) voiceClose.addEventListener("click", closeVoiceModal);
    if (voiceModal)
      voiceModal.addEventListener("click", (e) => {
        if (e.target === voiceModal) closeVoiceModal();
      });

    if (voiceClear)
      voiceClear.addEventListener("click", () => {
        if (voiceSearch) voiceSearch.value = "";
        renderVoiceGrid("");
      });
    if (voiceSearch) voiceSearch.addEventListener("input", () => renderVoiceGrid(voiceSearch.value));

    if (voiceGrid)
      voiceGrid.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;

        const act = btn.dataset.act;
        const id = btn.dataset.id;
        const voice = VOICES.find((v) => v.id === id);
        if (!voice) return;

        if (act === "preview") previewVoice(voice);
        if (act === "use") setSelectedVoice(voiceTarget, voice);
      });

    (function initVoiceLabels() {
      const pv = findVoiceById(postVoiceEl?.value);
      const sv = findVoiceById(scriptVoiceEl?.value);
      if (postVoiceLabel) postVoiceLabel.textContent = pv?.name || "Default";
      if (scriptVoiceLabel) scriptVoiceLabel.textContent = sv?.name || "Default";
    })();

    // ==========================================================
    // ✅ Render polling + payload + generate (AUTH)
    // ==========================================================
    async function pollReddit(renderId) {
      for (;;) {
        await __nfSleep(2500);

        const { res, json } = await nfFetchJson(API_BASE + "/api/reddit-video?id=" + encodeURIComponent(renderId), {
          method: "GET",
          headers: await nfAuthHeaders({}),
        });

        const st = String(json?.status || "").toLowerCase();
        if ((st.includes("succeed") || st === "completed") && json?.url) return json.url;
        if (st.includes("fail")) throw new Error(json?.error || "Render failed");

        if (res.status === 401) throw new Error("Session expired (401). Please refresh and log in again.");

        const cur = Number((barEl?.style?.width || "55%").replace("%", "")) || 55;
        setProgress(Math.min(92, cur + 4));
      }
    }

    function buildPayload() {
      const capEnabledEl = document.getElementById("caption-enabled-value");
      const capStyleEl = document.getElementById("caption-style-value");
      const capSettingsEl = document.getElementById("caption-settings-value");

      const captionsEnabled = String(capEnabledEl?.value || "0") === "1";
      const captionStyle = String(capStyleEl?.value || "").trim();
      const captionSettingsRaw = String(capSettingsEl?.value || "").trim();

      let captionSettings = null;
      if (captionsEnabled && captionSettingsRaw) {
        try {
          captionSettings = JSON.parse(captionSettingsRaw);
        } catch {
          captionSettings = null;
        }
      }

      const postVoiceId = String(postVoiceEl?.value || "default").trim();
      const scriptVoiceId = String(scriptVoiceEl?.value || "default").trim();

      const postOpts = window.nfGetVoiceOpts("post", postVoiceId);
      const scriptOpts = window.nfGetVoiceOpts("script", scriptVoiceId);

      const payload = {
        username: String(readAnyText(usernameEl)).trim(),
        mode: modeHidden?.value || "light",
        pfpUrl: String(getPfpUrl() || "").trim(),
        postTitle: String(readAnyText(postTitleEl)).trim(),
        postText: getPostTextForPayload(),
        likes: String(readAnyText(likesEl) || "0").trim(),
        comments: String(readAnyText(commentsEl) || "0").trim(),
        shareText: String(readAnyText(shareTextEl) || "share").trim(),

        postVoice: postVoiceId || "default",
        scriptVoice: scriptVoiceId || "default",
        script: String(readAnyText(scriptEl)).trim(),

        tone: String(readAnyText(toneHidden)).trim(),
        length: String(readAnyText(lenHidden)).trim(),
        backgroundVideoUrl: bgLibraryUrl,
        backgroundVideoName: bgLibraryName,

        postVoiceSpeed: postOpts.speed,
        postVoiceVolume: postOpts.volume,
        scriptVoiceSpeed: scriptOpts.speed,
        scriptVoiceVolume: scriptOpts.volume,
      };

      if (captionsEnabled && captionStyle && captionSettings) {
        payload.captionsEnabled = true;
        payload.captionStyle = captionStyle;
        payload.captionSettings = captionSettings;
      } else {
        payload.captionsEnabled = false;
      }

      return payload;
    }

    if (genBtn) {
      genBtn.addEventListener("click", async () => {
        try {
          if (!bgLibraryUrl || !String(bgLibraryUrl).startsWith("http")) {
            throw new Error("Missing backgroundVideoUrl (use library or upload a file first)");
          }

          const pfp = String(getPfpUrl() || "");
          if (pfp.startsWith("blob:")) {
            throw new Error("Profile picture is still preview-only. Wait for upload to finish.");
          }

          const member = await nfGetCurrentMemberSafe();
          const token = await nfGetMsToken();

          console.log("[rv] ms globals:", !!window.$memberstackDom, !!window.$memberstack, !!window.MemberStack);
          console.log("[rv] ms member?", member ? "YES" : "NO", member || null);
          console.log("[rv] ms token?", token ? `YES (${token.length} chars)` : "NO");

          if (!token) {
            if (member) {
              throw new Error(
                "Memberstack shows you are logged in, but no JWT token is available to send to the backend.\n\n" +
                  "This usually means JWTs aren't enabled for your Memberstack project/site or the token API is blocked on this domain.\n" +
                  "Enable Memberstack JWT/token access for this site, then refresh."
              );
            }
            throw new Error("Not logged in (Memberstack token missing). Refresh, log in, and try again.");
          }

          hideDemo();
          if (overlayEl) {
            overlayEl.classList.remove("nf-hide");
            overlayEl.textContent = "Rendering…";
          }

          setStatus("Starting…");
          setProgress(20);

          const payload = buildPayload();

          const { res, json } = await nfFetchJson(API_BASE + "/api/reddit-video", {
            method: "POST",
            headers: await nfAuthHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(payload),
          });

          if (!res.ok || json?.ok === false) {
            console.error("[rv] backend error =>", json);
            throw new Error(json?.error || json?.message || json?.raw || "HTTP " + res.status);
          }

          if (!json?.renderId) throw new Error("Missing renderId from backend.");

          setStatus("Rendering…");
          setProgress(55);

          const url = await pollReddit(json.renderId);

          setProgress(100);
          setStatus("Done ✓");

          showRender(url);

          const name = payload.postTitle || payload.username || "reddit-video";
          lastRenderName = name;
          lastRenderDl = downloadProxyUrl(url, safeFilename(lastRenderName));
          setDownloadEnabled(true);
        } catch (e) {
          console.error("[rv] generate failed =>", e);
          setProgress(0);
          setStatus("Error: " + (e?.message || e));
          alert("Generate failed: " + (e?.message || e));
          showDemo();
        }
      });
    }

    if (dlBtn) {
      dlBtn.addEventListener("click", () => {
        if (!lastRenderDl) return;
        const a = document.createElement("a");
        a.href = lastRenderDl;
        a.setAttribute("download", safeFilename(lastRenderName));
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
    }

    // start
    showDemo();
    updateCard();
    warmPreviews();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
