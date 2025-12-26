/* /public/nf-my-videos.js  (no serverless function) */
(function () {
  var CFG = window.NF_MYVIDEOS || {};
  var API_BASE = CFG.apiBase || "https://nofacelabs-backend.vercel.app";

  var root = document.getElementById("nfMyVideos");
  var listEl = document.getElementById("nfList");
  var refreshBtn = document.getElementById("nfRefresh");

  // If the embed is duplicated on the page, don't run twice.
  if (!root || root.__nfBound) return;
  root.__nfBound = true;

  function esc(s) {
    s = String(s == null ? "" : s);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function fmtDate(iso) {
    try { return iso ? new Date(iso).toLocaleString() : ""; }
    catch (e) { return String(iso || ""); }
  }

  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  // --- Memberstack token (wait until it actually loads) ---
  async function waitForMemberstack(timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.$memberstackDom) return true;
      await sleep(100);
    }
    throw new Error("MEMBERSTACK_NOT_LOADED");
  }

  async function getMemberToken() {
    await waitForMemberstack();

    if (window.$memberstackDom && typeof window.$memberstackDom.getToken === "function") {
      var t = await window.$memberstackDom.getToken();
      if (t && t.data && t.data.token) return String(t.data.token);
    }

    if (window.$memberstackDom && typeof window.$memberstackDom.getMemberCookie === "function") {
      var c = await window.$memberstackDom.getMemberCookie();
      if (c && c.data && c.data.token) return String(c.data.token);
      if (typeof c === "string") return String(c);
    }

    throw new Error("TOKEN_NOT_AVAILABLE");
  }

  async function apiGetRenders(token) {
    var r = await fetch(API_BASE + "/api/renders", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      cache: "no-store"
    });
    var j = {};
    try { j = await r.json(); } catch(e) {}
    if (!r.ok || !j.ok) throw new Error(j.error || j.message || ("renders failed (" + r.status + ")"));
    return j.items || [];
  }

  async function apiGetRenderById(id, token) {
    var r = await fetch(API_BASE + "/api/renders?id=" + encodeURIComponent(id), {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      cache: "no-store"
    });
    var j = {};
    try { j = await r.json(); } catch(e) {}
    if (!r.ok || !j.ok) throw new Error(j.error || j.message || ("render failed (" + r.status + ")"));
    return j.item;
  }

  // IMPORTANT: captions-start is now an ACTION on POST /api/renders
  async function apiStartCaptions(id, token, templateValue) {
    var r = await fetch(API_BASE + "/api/renders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({
        action: "captions-start",
        id: id, // ✅ THIS WAS MISSING IN YOUR OLD CALL
        templateId: templateValue || "",
        templateName: templateValue || ""
      })
    });
    var j = {};
    try { j = await r.json(); } catch(e) {}
    if (!r.ok || !j.ok) throw new Error(j.error || j.message || ("captions-start failed (" + r.status + ")"));
    return j;
  }

  async function apiGetSubmagicTemplates(token) {
    var r = await fetch(API_BASE + "/api/submagic-templates", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
      cache: "no-store"
    });
    var j = {};
    try { j = await r.json(); } catch(e) {}
    if (!r.ok || !j.ok) throw new Error(j.error || j.message || ("templates failed (" + r.status + ")"));
    var list = Array.isArray(j.templates) ? j.templates : [];
    return list
      .map(function(t){
        var v = String((t && (t.value || t.label)) || "").trim();
        var l = String((t && (t.label || t.value)) || "").trim();
        return { value: v, label: l || v };
      })
      .filter(function(x){ return x.value; });
  }

  function normCaptionStatus(item) {
    var s = String((item && item.caption_status) || "").toLowerCase();
    if (!s) return "";
    if (s.indexOf("done") >= 0 || s.indexOf("complete") >= 0 || s.indexOf("success") >= 0) return "completed";
    if (s.indexOf("fail") >= 0 || s.indexOf("error") >= 0) return "failed";
    if (s.indexOf("skip") >= 0) return "skipped";
    return s;
  }

  function pickPlaybackUrl(item) {
    if (item && item.captioned_video_url) return String(item.captioned_video_url);
    return String((item && item.video_url) || "");
  }

  // --- Minimal styles for cards + modal (injected) ---
  function injectCssOnce() {
    if (document.getElementById("nfMyVideosJsCss")) return;
    var st = document.createElement("style");
    st.id = "nfMyVideosJsCss";
    st.textContent = [
      ".nf-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;}",
      "@media (max-width:1200px){.nf-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}",
      "@media (max-width:900px){.nf-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}",
      "@media (max-width:520px){.nf-grid{grid-template-columns:1fr;}}",
      ".nf-card{border-radius:18px;border:1px solid rgba(10,14,26,.12);background:#fff;overflow:hidden;cursor:pointer;position:relative;}",
      ".nf-card:hover{border-color:rgba(90,193,255,.6);box-shadow:0 14px 32px rgba(10,14,26,.12);transform:translateY(-2px);transition:all 140ms ease;}",
      ".nf-poster{width:100%;aspect-ratio:9/16;background:rgba(10,14,26,.06);display:flex;align-items:center;justify-content:center;}",
      ".nf-poster img{width:100%;height:100%;object-fit:cover;display:block;}",
      ".nf-body{padding:12px 12px 14px;}",
      ".nf-title{font-weight:900;font-size:14px;color:#0A0E1A;}",
      ".nf-meta{margin-top:6px;font-size:12px;opacity:.75;}",
      ".nf-modalWrap{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(10,14,26,.55);z-index:99999;padding:18px;}",
      ".nf-modalWrap.open{display:flex;}",
      ".nf-modal{width:min(980px,100%);background:#fff;border-radius:18px;border:1px solid rgba(10,14,26,.12);overflow:hidden;box-shadow:0 30px 80px rgba(10,14,26,.25);}",
      ".nf-modalHeader{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(10,14,26,.08);}",
      ".nf-modalTitle{font-weight:950;font-size:16px;color:#0A0E1A;}",
      ".nf-modalSub{margin-top:4px;font-size:12px;opacity:.7;}",
      ".nf-xBtn{width:38px;height:38px;border-radius:12px;border:1px solid rgba(10,14,26,.12);background:#fff;cursor:pointer;font-size:18px;line-height:1;}",
      ".nf-modalBody{padding:14px 16px 16px;}",
      ".nf-modalGrid{display:grid;grid-template-columns:320px 1fr;gap:14px;}",
      "@media (max-width:840px){.nf-modalGrid{grid-template-columns:1fr;}}",
      ".nf-player{width:100%;aspect-ratio:9/16;border-radius:14px;border:1px solid rgba(10,14,26,.12);background:#000;overflow:hidden;}",
      ".nf-player video{width:100%;height:100%;object-fit:contain;background:#000;display:block;}",
      ".nf-btn2{padding:10px 12px;border-radius:12px;border:1px solid rgba(10,14,26,.12);background:#fff;cursor:pointer;text-decoration:none;color:#0A0E1A;font-weight:800;font-size:13px;display:inline-flex;align-items:center;justify-content:center;}",
      ".nf-btn2.primary{background:#5AC1FF;border-color:#5AC1FF;}",
      ".nf-pre{margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(10,14,26,.10);background:rgba(10,14,26,.03);font-size:12px;overflow:auto;max-height:220px;white-space:pre-wrap;}",
      ".nf-fieldLabel{font-size:12px;opacity:.75;margin:10px 0 6px;}",
      ".nf-select{width:100%;padding:10px 12px;border-radius:12px;border:1px solid rgba(10,14,26,.14);background:#fff;font-weight:750;color:#0A0E1A;}"
    ].join("\n");
    document.head.appendChild(st);
  }

  injectCssOnce();

  // --- Modal ---
  var modalWrap = document.querySelector(".nf-modalWrap");
  if (!modalWrap) {
    modalWrap = document.createElement("div");
    modalWrap.className = "nf-modalWrap";
    modalWrap.innerHTML =
      '<div class="nf-modal" role="dialog" aria-modal="true">' +
        '<div class="nf-modalHeader">' +
          '<div>' +
            '<div class="nf-modalTitle" id="nfModalTitle">Video</div>' +
            '<div class="nf-modalSub" id="nfModalSub">—</div>' +
          '</div>' +
          '<button class="nf-xBtn" type="button" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="nf-modalBody" id="nfModalBody"></div>' +
      '</div>';
    document.body.appendChild(modalWrap);
  }

  var modalTitle = modalWrap.querySelector("#nfModalTitle");
  var modalSub = modalWrap.querySelector("#nfModalSub");
  var modalBody = modalWrap.querySelector("#nfModalBody");
  var xBtn = modalWrap.querySelector(".nf-xBtn");
  var pollHandle = null;
  var templateCache = null;

  function openModal(){ modalWrap.classList.add("open"); document.documentElement.style.overflow = "hidden"; }
  function closeModal(){
    modalWrap.classList.remove("open");
    document.documentElement.style.overflow = "";
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }

  modalWrap.addEventListener("click", function(e){ if (e.target === modalWrap) closeModal(); });
  xBtn.addEventListener("click", closeModal);
  document.addEventListener("keydown", function(e){ if (e.key === "Escape" && modalWrap.classList.contains("open")) closeModal(); });

  async function ensureTemplatesLoaded() {
    if (templateCache) return templateCache;
    var token = await getMemberToken();
    templateCache = await apiGetSubmagicTemplates(token);
    return templateCache;
  }

  function setModal(item) {
    var status = String(item.status || "");
    var created = fmtDate(item.created_at);
    var playbackUrl = pickPlaybackUrl(item);
    var capStatus = normCaptionStatus(item);
    var capUrl = item.captioned_video_url ? String(item.captioned_video_url) : "";

    modalTitle.textContent = (item.choices && (item.choices.storyType || item.choices.customPrompt)) ? (item.choices.storyType || "Custom prompt") : "Video";
    modalSub.textContent = created + " • Status: " + status;

    var options = '<option value="">Choose a caption style…</option>';
    (templateCache || []).forEach(function(t){
      options += '<option value="' + esc(t.value) + '">' + esc(t.label) + "</option>";
    });

    modalBody.innerHTML =
      '<div class="nf-modalGrid">' +
        '<div>' +
          '<div class="nf-player">' +
            (playbackUrl ? '<video controls playsinline preload="metadata"><source src="' + esc(playbackUrl) + '" type="video/mp4"></video>' : '<div style="padding:14px;opacity:.75;">Video not ready yet</div>') +
          '</div>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
            (playbackUrl ? '<a class="nf-btn2 primary" href="' + esc(playbackUrl) + '" target="_blank" rel="noopener">Open</a>' : '') +
            '<button class="nf-btn2" type="button" id="nfCloseBtn">Close</button>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div style="font-weight:950;color:#0A0E1A;margin-bottom:8px;">Captions</div>' +
          '<div style="padding:10px 12px;border-radius:12px;border:1px solid rgba(10,14,26,.10);background:rgba(10,14,26,.03);font-size:12px;">' +
            (capUrl ? 'Captions: completed ✅' : ('Captions: ' + (capStatus || 'not started'))) +
          '</div>' +
          '<div class="nf-fieldLabel">Caption style</div>' +
          '<select class="nf-select" id="nfTpl">' + options + '</select>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">' +
            '<button class="nf-btn2 primary" type="button" id="nfStartCaps">Add Captions</button>' +
            (capUrl ? '<a class="nf-btn2" href="' + esc(capUrl) + '" target="_blank" rel="noopener">Open Captioned</a>' : '') +
          '</div>' +
          '<div id="nfCapHint" style="margin-top:8px;opacity:.75;font-size:12px;"></div>' +
          '<div class="nf-pre">' + esc(JSON.stringify(item, null, 2)) + "</div>" +
        "</div>" +
      "</div>";

    modalBody.querySelector("#nfCloseBtn").addEventListener("click", closeModal);

    modalBody.querySelector("#nfStartCaps").addEventListener("click", async function(){
      try {
        var hint = modalBody.querySelector("#nfCapHint");
        hint.textContent = "Starting captions…";
        var token = await getMemberToken();
        var sel = modalBody.querySelector("#nfTpl");
        var chosen = sel ? String(sel.value || "").trim() : "";
        await apiStartCaptions(item.id, token, chosen);
        hint.textContent = "Captioning started. This will update automatically…";
        startPolling(item.id);
      } catch (e) {
        var hint2 = modalBody.querySelector("#nfCapHint");
        hint2.textContent = "Failed to start captions: " + String(e && e.message ? e.message : e);
      }
    });
  }

  function startPolling(id) {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    pollHandle = setInterval(async function(){
      try {
        if (!modalWrap.classList.contains("open")) { clearInterval(pollHandle); pollHandle = null; return; }
        var token = await getMemberToken();
        var item = await apiGetRenderById(id, token);

        // Stop when captioned url exists or failed
        var capUrl = item.captioned_video_url ? String(item.captioned_video_url) : "";
        var capStatus = normCaptionStatus(item);
        setModal(item);

        if (capUrl || capStatus === "failed" || capStatus === "skipped") {
          clearInterval(pollHandle);
          pollHandle = null;
          loadList();
        }
      } catch (e) {
        // keep polling quietly
      }
    }, 3500);
  }

  function render(items) {
    if (!listEl) return;

    if (!items || !items.length) {
      listEl.innerHTML = '<div style="opacity:.85;padding:14px;border-radius:14px;border:1px solid rgba(10,14,26,.12);background:#fff;">No videos yet. Go create one.</div>';
      return;
    }

    var html = '<div class="nf-grid">';
    items.forEach(function(it){
      var title = (it.choices && (it.choices.storyType || it.choices.customPrompt)) ? (it.choices.storyType || "Custom prompt") : "Video";
      var poster = it.video_url ? ('<img src="" alt="" />') : ""; // keep simple (no autoplay previews)

      html +=
        '<div class="nf-card" data-open="' + esc(it.id) + '">' +
          '<div class="nf-poster">' +
            (it.video_url
              ? '<img src="https://dummyimage.com/600x1066/eeeeee/777777&text=▶" alt="Video thumbnail" style="width:100%;height:100%;object-fit:cover;" />'
              : '<div style="opacity:.7;">Rendering…</div>') +
          "</div>" +
          '<div class="nf-body">' +
            '<div class="nf-title">' + esc(title) + "</div>" +
            '<div class="nf-meta">' + esc("Status: " + (it.status || "")) + "</div>" +
          "</div>" +
        "</div>";
    });
    html += "</div>";

    listEl.innerHTML = html;

    // click handler (event delegation)
    listEl.onclick = async function(e){
      var card = e.target && e.target.closest ? e.target.closest(".nf-card[data-open]") : null;
      if (!card) return;
      var id = card.getAttribute("data-open");
      try {
        openModal();
        modalTitle.textContent = "Loading…";
        modalSub.textContent = "—";
        modalBody.innerHTML = '<div style="opacity:.75;">Loading…</div>';

        await ensureTemplatesLoaded();
        var token = await getMemberToken();
        var item = await apiGetRenderById(id, token);
        setModal(item);
      } catch (err) {
        modalTitle.textContent = "Error";
        modalSub.textContent = "—";
        modalBody.innerHTML = '<div style="white-space:pre-wrap;opacity:.9;">' + esc(String(err && err.message ? err.message : err)) + "</div>";
      }
    };
  }

  async function loadList() {
    if (listEl) listEl.textContent = "Loading…";
    var token = await getMemberToken();
    var items = await apiGetRenders(token);
    render(items);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", function(){ loadList(); });
  }

  loadList().catch(function(e){
    if (listEl) listEl.innerHTML =
      '<div style="opacity:.9;padding:14px;border-radius:14px;border:1px solid rgba(255,80,80,.35);background:#fff;">' +
      esc(String(e && e.message ? e.message : e)) +
      "</div>";
  });
})();
