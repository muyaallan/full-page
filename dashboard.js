/* =========================================================
 *  dashboard.js — authenticated dashboard
 * ========================================================= */

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let session = null;

init();

async function init() {
  session = await CPT_AUTH.getSession();
  if (!session || !session.token) {
    // Not signed in → bounce to welcome.
    location.replace(chrome.runtime.getURL("welcome.html"));
    return;
  }
  renderUser(session);

  // Routing
  wireNav();
  routeFromHash();

  // Buttons
  $("#signOutBtn").addEventListener("click", async () => {
    await CPT_AUTH.signOut();
    location.replace(chrome.runtime.getURL("welcome.html"));
  });
  $("#openWelcome").addEventListener("click", () =>
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") })
  );
  $("#openOptions").addEventListener("click", () =>
    chrome.tabs.create({ url: "chrome://extensions/?id=" + chrome.runtime.id })
  );
  $("#backBtn").addEventListener("click", () => history.back());

  // Quick actions (act on the last-focused non-extension tab)
  $("#qaCapture").addEventListener("click", () => sendToActiveTab({ type: "CPT_TRIGGER_SHOT" }, true));
  $("#qaCopy").addEventListener("click", () => sendToActiveTab({ type: "CPT_COPY_ARTICLE" }));
  $("#qaHighlight").addEventListener("click", () => sendToActiveTab({ type: "HL_HIGHLIGHT", color: "yellow" }));

  $("#qaShortcuts").addEventListener("click", () =>
    alert("Alt+H  highlight selection\nAlt+C  toggle copy unlock\nAlt+S  full-page screenshot")
  );

  // Profile / settings / controls load
  await loadSettingsUI();
  wireSettingsSave();
  wireSourcesPreview();
}

/* ---------- user ---------- */
function renderUser(session) {
  const u = session.user || {};
  const name = u.name || (u.email ? u.email.split("@")[0] : "You");
  $("#sbName").textContent = name;
  $("#sbEmail").textContent = u.email || "";
  $("#sbAvatar").textContent = (name[0] || "•").toUpperCase();
  $("#firstName").textContent = name;
  $("#pName").textContent = name;
  $("#pEmail").textContent = u.email || "—";
  $("#pId").textContent = u.id || "—";
  $("#pSince").textContent = session.issuedAt ? new Date(session.issuedAt).toLocaleString() : "—";
  $("#pPlan").textContent = u.plan || "Free";
}

/* ---------- routing ---------- */
function wireNav() {
  $$("[data-route]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      location.hash = "#" + el.dataset.route;
    });
  });
  window.addEventListener("hashchange", routeFromHash);
}
function routeFromHash() {
  const route = (location.hash.replace(/^#/, "") || "home").toLowerCase();
  const valid = ["home", "profile", "settings", "controls", "sources"];
  const r = valid.includes(route) ? route : "home";
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== r));
  $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.route === r));
  const titles = { home: "Home", profile: "Profile", settings: "Settings", controls: "Text controls", sources: "Sources" };
  $("#pageTitle").textContent = titles[r];
  $("#backBtn").hidden = r === "home";
}

/* ---------- quick actions ---------- */
async function sendToActiveTab(msg, closeSelfFirst = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return alert("No active tab.");
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    alert("Couldn't reach the page. Make sure you're on a normal website (not chrome:// or a store page).");
  }
}

/* ---------- settings persistence ---------- */
const SETTINGS_KEY = "cpt:settings";

async function loadSettingsUI() {
  const { [SETTINGS_KEY]: s = {} } = await chrome.storage.local.get(SETTINGS_KEY);

  $("#sRemember").checked = !!(session && session.remember);
  $("#sOpenDashboard").checked = s.openDashboard !== false;
  $("#sMaxHeight").value = s.maxHeight || 32000;

  $("#cIgnoreNav").checked = s.ignoreNav !== false;
  $("#cStripAds").checked = s.stripAds !== false;
  $("#cMinLinkPenalty").checked = s.minLinkPenalty !== false;
  $("#cDefaultColor").value = s.defaultColor || "#ffe066";
}
function wireSettingsSave() {
  $("#saveSettings").addEventListener("click", async () => {
    const { [SETTINGS_KEY]: s = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    s.openDashboard = $("#sOpenDashboard").checked;
    s.maxHeight = parseInt($("#sMaxHeight").value, 10) || 32000;
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
    await chrome.storage.local.set({ maxHeight: s.maxHeight });
    alert("Settings saved.");
  });
  $("#saveControls").addEventListener("click", async () => {
    const { [SETTINGS_KEY]: s = {} } = await chrome.storage.local.get(SETTINGS_KEY);
    s.ignoreNav = $("#cIgnoreNav").checked;
    s.stripAds = $("#cStripAds").checked;
    s.minLinkPenalty = $("#cMinLinkPenalty").checked;
    s.defaultColor = $("#cDefaultColor").value;
    await chrome.storage.local.set({ [SETTINGS_KEY]: s });
    alert("Text controls saved.");
  });
}

/* ---------- sources preview ---------- */
const SOURCE_NOTES = {
  index: "index.js — Extension entry point.\n\nResponsible for:\n• service worker registration\n• first-install welcome page\n• context-menu creation\n• command routing (Alt+H / Alt+C / Alt+S)\n• install/update lifecycle",
  auth: "auth.js — Magic-link authentication.\n\nResponsible for:\n• requesting a magic link from the backend\n• verifying the returned token\n• persisting the session in chrome.storage\n• exposing isSignedIn() / signOut()",
  content: "content.js — Content script.\n\nResponsible for:\n• selecting and wrapping text into <mark> highlights\n• persisting highlights as text-quote records\n• article extraction with a scoring heuristic\n• the floating selection chip (Copy / Highlight / Article / Drag)\n• the copy-protection override",
  capture: "sw.js — Background service worker.\n\nResponsible for:\n• the full-page screenshot engine (CDP fast path + scroll-and-stitch)\n• the clipboard bridge (via offscreen document)\n• message routing to content scripts\n• authentication gate on every capture/copy operation",
  popup: "popup.js — Toolbar popup.\n\nResponsible for:\n• showing the authenticated user\n• color picker, unlock toggle, action buttons\n• highlight list for the current page",
  dashboard: "dashboard.js — Dashboard page.\n\nResponsible for:\n• routing between Home / Profile / Settings / Controls / Sources\n• loading and saving user preferences\n• displaying account info",
  settings: "Settings & preferences.\n\nStored in chrome.storage.local under cpt:settings.\n\nKeys:\n• openDashboard\n• maxHeight\n• ignoreNav\n• stripAds\n• minLinkPenalty\n• defaultColor",
};
function wireSourcesPreview() {
  const pre = $("#srcPreview");
  $$(".sources button").forEach((b) => {
    b.addEventListener("click", () => {
      pre.textContent = SOURCE_NOTES[b.dataset.src] || "No notes.";
    });
  });
}