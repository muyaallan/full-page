/* =========================================================
 *  popup.js (v2.1.0) — auth-aware popup with extract preview
 * ========================================================= */
const COLOR_KEY = "cpt:selectedColor";
let activeTabId = null;
let activeTabUrl = "";
let session = null;

init();

/* =========================================================
 *  Entry
 * ========================================================= */
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) {
    activeTabId = tab.id;
    activeTabUrl = tab.url || "";
  }
  setHeaderStatus(shortUrl(activeTabUrl));

  session = await CPT_AUTH.getSession();

  if (!session || !session.token) {
    showSignedOut();
  } else {
    await showSignedIn();
  }

  // Sign-in handler
  document.getElementById("signinForm").addEventListener("submit", onSignIn);
}

/* =========================================================
 *  Signed out
 * ========================================================= */
function showSignedOut() {
  document.getElementById("signinPanel").classList.add("on");
  document.getElementById("toolsView").classList.remove("on");
  document.getElementById("accountChip").hidden = true;
}

async function onSignIn(e) {
  e.preventDefault();
  const email = (document.getElementById("popupEmail").value || "").trim();
  const msgEl = document.getElementById("popupMsg");
  const btn = document.getElementById("popupSendBtn");
  if (!email) return;

  btn.disabled = true;
  msgEl.className = "msg";
  msgEl.textContent = "Sending your sign-in link…";

  try {
    const returnUrl = chrome.runtime.getURL("auth-callback.html");
    await CPT_AUTH.requestMagicLink(email, returnUrl);
    await chrome.storage.local.set({ "cpt:remember": true });
    msgEl.className = "msg ok";
    msgEl.textContent = `Check your inbox — we sent a link to ${email}. Open it in this browser.`;
  } catch (err) {
    console.error("[popup] magic-link failed:", err);
    msgEl.className = "msg err";
    msgEl.textContent = friendlyAuthError(err);
  } finally {
    btn.disabled = false;
  }
}

/* =========================================================
 *  Signed in
 * ========================================================= */
async function showSignedIn() {
  document.getElementById("signinPanel").classList.remove("on");
  document.getElementById("toolsView").classList.add("on");
  document.getElementById("accountChip").hidden = false;

  renderChip(session);

  // Color
  const { [COLOR_KEY]: savedColor } = await chrome.storage.local.get(COLOR_KEY);
  setActiveSwatch(savedColor || "yellow");

  // Load persisted max height (used by SW)
  const { maxHeight = 32000 } = await chrome.storage.local.get("maxHeight");
  // (not exposed in this popup version — done in dashboard)

  // Tab-side state
  const blocked = blockedReason(activeTabUrl);
  if (blocked) {
    setHeaderStatus("blocked");
    document.querySelectorAll("#toolsView button, #unlock-switch, .sw").forEach((el) => {
      el.disabled = true;
      el.style.opacity = "0.45";
      el.style.cursor = "not-allowed";
      el.style.pointerEvents = "none";
    });
    // Keep the navigation buttons working
    ["btn-dashboard", "btn-welcome"].forEach((id) => {
      const b = document.getElementById(id);
      if (b) { b.disabled = false; b.style.opacity = "1"; b.style.cursor = "pointer"; b.style.pointerEvents = "auto"; }
    });
    return;
  }

  const ok = await ensureContentScript();
  setHeaderStatus(ok ? "ready" : "no content script");
  if (ok) {
    await refreshUnlockState();
    await refreshHighlights();
  }

  wireToolButtons();
  wireAccountButtons();
}

function renderChip(session) {
  const u = session.user || {};
  const name = u.name || (u.email ? u.email.split("@")[0] : "You");
  document.getElementById("chipAvatar").textContent = (name[0] || "•").toUpperCase();
  document.getElementById("chipName").textContent = name;
  document.getElementById("chipEmail").textContent = u.email || "";
}

function wireToolButtons() {
  const withFeedback = (id, msg, okLabel) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", async () => {
      el.disabled = true;
      const prev = el.textContent;
      el.textContent = "…";
      let resp = null;
      try { resp = await sendToTab(msg); } catch (e) { console.warn("[popup] send failed:", e); }
      el.disabled = false;
      el.textContent = prev;
      if (resp && resp.ok) {
        setHeaderStatus(okLabel || "copied");
        setTimeout(() => window.close(), 250);
        return;
      }
      const reason = resp == null ? "no content script" : (resp.error ? String(resp.error) : "failed");
      setHeaderStatus(reason);
      console.warn("[popup]", msg.type, "->", resp);
    });
  };

  withFeedback("btn-copy-sel",     { type: "CPT_COPY_PLAIN" },     "copied");
  withFeedback("btn-copy-article", { type: "CPT_COPY_ARTICLE" },   "copied");
  withFeedback("btn-copy-page",    { type: "CPT_COPY_PAGE_TEXT" }, "copied");
  withFeedback("btn-hl",           { type: "HL_HIGHLIGHT", color: getActiveColor() }, "highlighted");

  const btnExtract = document.getElementById("btn-extract");
  if (btnExtract) btnExtract.addEventListener("click", async () => {
    const resp = await chrome.runtime.sendMessage({ type: "CPT_OPEN_EXTRACT" });
    if (resp && resp.ok) window.close();
    else setHeaderStatus(resp && resp.error ? resp.error : "extract failed");
  });

  const btnShot = document.getElementById("btn-shot");
  if (btnShot) btnShot.addEventListener("click", async () => {
    const resp = await chrome.runtime.sendMessage({ type: "CPT_TRIGGER_SHOT" });
    if (resp && resp.ok) window.close();
    else setHeaderStatus(resp && resp.error ? resp.error : "shot failed");
  });

  const btnPick = document.getElementById("btn-pick-scroller");
  if (btnPick) btnPick.addEventListener("click", async () => {
    const resp = await chrome.runtime.sendMessage({ type: "CPT_START_PICKER" });
    if (resp && resp.ok) window.close();
    else setHeaderStatus("picker failed");
  });

  document.getElementById("btn-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  document.getElementById("btn-welcome").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  });

  const unlock = document.getElementById("unlock-switch");
  if (unlock) unlock.addEventListener("click", async () => {
    const resp = await sendToTab({ type: "CPT_TOGGLE_UNLOCK" });
    if (resp && typeof resp.unlocked !== "undefined") setUnlockSwitch(resp.unlocked);
  });

  document.querySelectorAll(".sw").forEach((el) => {
    el.addEventListener("click", async () => {
      const color = el.dataset.color;
      setActiveSwatch(color);
      await chrome.storage.local.set({ [COLOR_KEY]: color });
    });
  });

  document.getElementById("hl-list").addEventListener("click", async (e) => {
    const del = e.target.closest(".del");
    if (del) {
      e.stopPropagation();
      await sendToTab({ type: "HL_DELETE", id: del.dataset.id });
      await refreshHighlights();
      return;
    }
    const li = e.target.closest("li[data-id]");
    if (li) {
      await sendToTab({ type: "HL_SCROLL_TO", id: li.dataset.id });
      window.close();
    }
  });
}
function wireAccountButtons() {
  document.getElementById("chipDashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
  document.getElementById("chipSignout").addEventListener("click", async () => {
    await CPT_AUTH.signOut();
    session = null;
    showSignedOut();
  });
}

/* =========================================================
 *  Guard
 * ========================================================= */
function blockedReason(url) {
  if (!url) return "no url";
  if (url.startsWith("chrome://")) return "chrome://";
  if (url.startsWith("chrome-extension://")) return "extension";
  if (url.startsWith("edge://")) return "edge://";
  if (url.startsWith("about:")) return "about:";
  if (url.startsWith("view-source:")) return "view-source";
  if (url.startsWith("devtools://")) return "devtools";
  if (url.startsWith("https://chrome.google.com/webstore")) return "web store";
  if (url.startsWith("https://chromewebstore.google.com")) return "web store";
  if (url.startsWith("file://")) return "file://";
  return null;
}
function shortUrl(url) {
  if (!url) return "(none)";
  try {
    const u = new URL(url);
    const p = u.pathname.length > 18 ? u.pathname.slice(0, 18) + "…" : u.pathname;
    return u.host + p;
  } catch { return url.slice(0, 30); }
}

/* =========================================================
 *  Content-script bridge
 * ========================================================= */
async function ensureContentScript() {
  if (activeTabId == null) return false;
  const ping = await rawSend({ type: "CPT_GET_STATE" });
  if (ping !== "__ERR__") return true;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: activeTabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId: activeTabId }, files: ["content.js"] });
    await new Promise((r) => setTimeout(r, 80));
    const ping2 = await rawSend({ type: "CPT_GET_STATE" });
    return ping2 !== "__ERR__";
  } catch (e) {
    console.warn("[popup] inject failed:", e.message);
    return false;
  }
}
function rawSend(msg) {
  return new Promise((resolve) => {
    if (activeTabId == null) return resolve("__ERR__");
    chrome.tabs.sendMessage(activeTabId, msg, (resp) => {
      if (chrome.runtime.lastError) return resolve("__ERR__");
      resolve(resp || null);
    });
  });
}
async function sendToTab(msg) {
  const resp = await rawSend(msg);
  return resp === "__ERR__" ? null : resp;
}

/* =========================================================
 *  Helpers
 * ========================================================= */
function getActiveColor() {
  const el = document.querySelector(".sw.active");
  return el ? el.dataset.color : "yellow";
}
function setActiveSwatch(color) {
  document.querySelectorAll(".sw").forEach((el) => {
    el.classList.toggle("active", el.dataset.color === color);
  });
}
function setUnlockSwitch(on) {
  document.getElementById("unlock-switch").classList.toggle("on", !!on);
}
function setHeaderStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text || "";
}
async function refreshUnlockState() {
  const resp = await sendToTab({ type: "CPT_GET_STATE" });
  if (resp && typeof resp.unlocked !== "undefined") setUnlockSwitch(resp.unlocked);
}
async function refreshHighlights() {
  const resp = await sendToTab({ type: "HL_LIST" });
  const list = (resp && resp.list) || [];
  const ul = document.getElementById("hl-list");
  const empty = document.getElementById("hl-empty-row");
  const count = document.getElementById("hl-count");
  ul.innerHTML = "";
  count.textContent = list.length ? `· ${list.length}` : "";
  empty.hidden = list.length > 0;
  for (const q of list) {
    const li = document.createElement("li");
    li.dataset.id = q.id;
    const dot = document.createElement("span");
    dot.className = "swatch-mini";
    dot.style.background = colorToHex(q.color);
    const txt = document.createElement("span");
    txt.className = "txt";
    txt.textContent = q.text.length > 60 ? q.text.slice(0, 60) + "…" : q.text;
    const del = document.createElement("button");
    del.className = "del";
    del.dataset.id = q.id;
    del.title = "Delete";
    del.textContent = "✕";
    li.append(dot, txt, del);
    ul.appendChild(li);
  }
}
function colorToHex(c) {
  return { yellow:"#ffe066", green:"#b2f2bb", blue:"#a5d8ff", pink:"#ffc9de", orange:"#ffd8a8" }[c] || "#ffe066";
}
function friendlyAuthError(err) {
  const msg = String(err && err.message || err);
  if (/404|not found/i.test(msg) || msg.includes("<!DOCTYPE")) {
    return "The server doesn't recognise the auth endpoint yet. Make sure the backend is deployed to makeent.netlify.app.";
  }
  if (/Failed to fetch/i.test(msg)) {
    return "Couldn't reach the server. Check your connection or that the API is deployed.";
  }
  return msg;
}
