/* =========================================================
 *  Copy-Proof Tools — service worker (v2.1.0)
 *  Screenshot engine: CDP fast-path → scroll+stitch fallback.
 *  Auth: every privileged operation is gated on a valid session.
 *  Extraction: structured text with preview page.
 * ========================================================= */

chrome.storage.session
  .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
  .catch(() => {});

const WELCOME_URL   = chrome.runtime.getURL("welcome.html");
const DASHBOARD_URL = chrome.runtime.getURL("dashboard.html");
const SESSION_KEY   = "cpt:session";

const DEFAULT_MAX_HEIGHT = 100000;
const MAX_HEIGHT_HARD    = 999999999;

/* Messages that require an authenticated session. */
/* Mirror the session into local storage so content scripts can always
   read an auth flag, regardless of session-storage access level. */
async function mirrorSession() {
  try {
    const mem = await chrome.storage.session.get(SESSION_KEY);
    const loc = await chrome.storage.local.get(SESSION_KEY);
    const s = mem[SESSION_KEY] || loc[SESSION_KEY] || null;
    if (s && s.token) {
      await chrome.storage.local.set({
        [SESSION_KEY]: s,
        "cpt:signedIn": true,
      });
    } else {
      await chrome.storage.local.remove(["cpt:signedIn"]);
    }
  } catch {}
}

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "session" || area === "local") && changes[SESSION_KEY]) {
    mirrorSession();
  }
});

chrome.runtime.onStartup.addListener(mirrorSession);
chrome.runtime.onInstalled.addListener(mirrorSession);
mirrorSession();
const PROTECTED_MESSAGES = new Set([
  "HL_HIGHLIGHT",
  "HL_RESTORE",
  "HL_CLEAR",
  "HL_LIST",
  "HL_DELETE",
  "HL_SCROLL_TO",
  "CPT_COPY_PLAIN",
  "CPT_COPY_SELECTION",
  "CPT_COPY_ARTICLE",
  "CPT_COPY_PAGE_TEXT",
  "CPT_COPY_STRUCTURED",
  "CPT_EXTRACT_STRUCTURED",
  "CPT_TRIGGER_SHOT",
  "CPT_TOGGLE_UNLOCK",
  "CPT_SET_UNLOCK",
]);

/* =========================================================
 *  Auth helpers
 * ========================================================= */

async function getSession() {
  const mem = await chrome.storage.session.get(SESSION_KEY);
  if (mem[SESSION_KEY]) return mem[SESSION_KEY];
  const loc = await chrome.storage.local.get(SESSION_KEY);
  return loc[SESSION_KEY] || null;
}

async function isSignedIn() {
  const s = await getSession();
  return !!(s && s.token);
}

async function requireAuth(reason) {
  if (await isSignedIn()) return true;
  console.warn(`[CPT] blocked ${reason}: not signed in`);
  openWelcomePage();
  return false;
}

function openWelcomePage() {
  chrome.tabs.query({ url: WELCOME_URL + "*" }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].id != null) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url: WELCOME_URL });
    }
  });
}

/* =========================================================
 *  Install / startup
 * ========================================================= */

chrome.runtime.onInstalled.addListener((details) => {
  buildContextMenus();
  if (details.reason === "install") {
    chrome.tabs.create({ url: WELCOME_URL });
  }
});

chrome.runtime.onStartup.addListener(buildContextMenus);

function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "cpt-hl-yellow", title: "Highlight selection (yellow)", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "cpt-hl-green",  title: "Highlight selection (green)",  contexts: ["selection"] });
    chrome.contextMenus.create({ id: "cpt-hl-blue",   title: "Highlight selection (blue)",   contexts: ["selection"] });
    chrome.contextMenus.create({ id: "cpt-copy-plain", title: "Copy selection as plain text", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "cpt-sep1", type: "separator", contexts: ["all"] });
    chrome.contextMenus.create({ id: "cpt-copy-article", title: "Copy article text", contexts: ["page", "selection"] });
    chrome.contextMenus.create({ id: "cpt-copy-page-text", title: "Copy full page text", contexts: ["page"] });
    chrome.contextMenus.create({ id: "cpt-sep2", type: "separator", contexts: ["all"] });
    chrome.contextMenus.create({ id: "cpt-screenshot", title: "Take full-page screenshot…", contexts: ["page", "selection"] });
    chrome.contextMenus.create({ id: "cpt-sep3", type: "separator", contexts: ["all"] });
    chrome.contextMenus.create({ id: "cpt-extract", title: "Preview extracted text…", contexts: ["page"] });
  });
}

/* =========================================================
 *  Context menu handlers (auth-gated)
 * ========================================================= */

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = info.menuItemId;

  if (id.startsWith("cpt-hl-")) {
    if (!(await requireAuth("context-menu:highlight"))) return;
    sendToTabSafe(tab.id, { type: "HL_HIGHLIGHT", color: id.replace("cpt-hl-", "") });
    return;
  }
  if (id === "cpt-copy-plain") {
    if (!(await requireAuth("context-menu:copy-plain"))) return;
    sendToTabSafe(tab.id, { type: "CPT_COPY_PLAIN" });
    return;
  }
  if (id === "cpt-copy-article") {
    if (!(await requireAuth("context-menu:copy-article"))) return;
    sendToTabSafe(tab.id, { type: "CPT_COPY_ARTICLE" });
    return;
  }
  if (id === "cpt-copy-page-text") {
    if (!(await requireAuth("context-menu:copy-page"))) return;
    sendToTabSafe(tab.id, { type: "CPT_COPY_PAGE_TEXT" });
    return;
  }
  if (id === "cpt-screenshot") {
    if (!(await requireAuth("context-menu:screenshot"))) return;
    captureFullPage(tab);
    return;
  }
  if (id === "cpt-extract") {
    if (!(await requireAuth("context-menu:extract"))) return;
    openExtractPreview(tab);
    return;
  }
});

/* =========================================================
 *  Keyboard commands (auth-gated)
 * ========================================================= */

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  if (!tab || tab.id == null) return;

  if (cmd === "highlight-selection") {
    if (!(await requireAuth("command:highlight"))) return;
    sendToTabSafe(tab.id, { type: "HL_HIGHLIGHT", color: "yellow" });
  } else if (cmd === "toggle-copy-unlock") {
    if (!(await requireAuth("command:toggle-unlock"))) return;
    sendToTabSafe(tab.id, { type: "CPT_TOGGLE_UNLOCK" });
  } else if (cmd === "screenshot-page") {
    if (!(await requireAuth("command:screenshot"))) return;
    captureFullPage(tab);
  }
});

/* =========================================================
 *  Content-script bridge
 *  Auto-injects the content script if it isn't present, then retries.
 * ========================================================= */

async function sendToTabSafe(tabId, msg, _retry = false) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    if (_retry) return null;
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      return sendToTabSafe(tabId, msg, true);
    } catch (injectErr) {
      console.warn("[CPT] inject failed:", injectErr.message);
      return null;
    }
  }
}

/* =========================================================
 *  EXTRACT PREVIEW
 * ========================================================= */

async function openExtractPreview(tab) {
  if (!tab || tab.id == null) return false;

  const resp = await sendToTabSafe(tab.id, { type: "CPT_EXTRACT_STRUCTURED" });
  if (!resp || !resp.ok || !resp.data) {
    notifyError("Extract failed");
    return false;
  }

  const key = "extract:" + Date.now();
  await chrome.storage.session.set({ [key]: resp.data });

  chrome.tabs.create({
    url: chrome.runtime.getURL("extract.html") +
         "?key=" + encodeURIComponent(key) +
         "&src=" + encodeURIComponent(tab.url || ""),
  });
  return true;
}

/* =========================================================
 *  SCREENSHOT ENGINE
 * ========================================================= */

async function captureFullPage(tab) {
  if (!tab || tab.id == null) return;

  const { maxHeight = DEFAULT_MAX_HEIGHT } = await chrome.storage.local.get("maxHeight");
  const cap = Math.min(Math.max(1000, maxHeight | 0), MAX_HEIGHT_HARD);

  let dataUrl  = null;
  let method   = "cdp";
  let exceeded = false;

  try {
    dataUrl = await cdpCapture(tab.id, cap);
  } catch (err) {
    console.warn("[CPT] CDP failed, using scroll-stitch:", err.message);
    method = "stitch";
    try {
      const result = await stitchCapture(tab.id, cap);
      dataUrl  = result.dataUrl;
      exceeded = result.exceeded;
    } catch (err2) {
      console.error("[CPT] stitch failed:", err2);
      notifyError("Screenshot failed");
      return;
    }
  }

  const key = "shot:" + Date.now();
  await chrome.storage.session.set({ [key]: dataUrl });

  const qs =
    "?key=" + encodeURIComponent(key) +
    "&src=" + encodeURIComponent(tab.url || "") +
    "&method=" + method +
    "&exceeded=" + (exceeded ? "1" : "0");
  chrome.tabs.create({ url: chrome.runtime.getURL("screenshot.html") + qs });
}

/* ---------- CDP fast path ---------- */

async function cdpCapture(tabId, cap) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    await chrome.debugger.sendCommand(target, "Page.enable");
    await new Promise((r) => setTimeout(r, 150));

    const metrics = await chrome.debugger.sendCommand(target, "Page.getLayoutMetrics");
    const cs = metrics.cssContentSize || metrics.contentSize;
    if (!cs || !cs.width || !cs.height) throw new Error("no measurable size");

    const w = Math.ceil(cs.width);
    const h = Math.ceil(cs.height);
    const MAX = 16384;

    if (h > MAX) throw new Error("height " + h + " exceeds compositor limit");
    // cap check removed

    const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      fromSurface: true,
      optimizeForSpeed: false,
      clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    });
    if (!shot || !shot.data) throw new Error("empty CDP result");
    return "data:image/png;base64," + shot.data;
  } finally {
    try { await chrome.debugger.detach(target); } catch {}
  }
}

/* ---------- Scroll + stitch fallback ---------- */

async function stitchCapture(tabId, cap) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: scrollAndStitchInPage,
    args: [cap],
  });
  return result;
}

function scrollAndStitchInPage(cap) {
  return new Promise(async (resolve, reject) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const SLICE_DELAY = 600;
    const SLICE_DELAY_RETRY = 1000;
    const MAX_RETRIES_PER_SLICE = 5;
    const STABLE_PASSES = 2;

    function loadImage(src) {
      return new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
    }

    async function captureVisible() {
      return await new Promise((res) => {
        chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE" }, (resp) => {
          res(resp && resp.dataUrl ? resp.dataUrl : null);
        });
      });
    }

    function hashFrame(dataUrl) {
      if (!dataUrl) return "";
      const L = dataUrl.length;
      const step = Math.max(1, Math.floor(L / 16));
      let h = L + ":";
      for (let i = 0; i < 16; i++) h += dataUrl.charCodeAt(i * step) + ",";
      return h;
    }

    try {
      /* ---- 1. Candidates ---- */
      const docEl = document.scrollingElement || document.documentElement;
      const candidates = [docEl, document.body, document.documentElement];
      document.querySelectorAll("*").forEach((el) => {
        if (!(el instanceof Element)) return;
        const cs = getComputedStyle(el);
        if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return;
        if (el.scrollHeight <= el.clientHeight + 20) return;
        candidates.push(el);
      });

      /* ---- 2. Probe which one really scrolls ---- */
      async function probe(el) {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll < 20) return { el, ok: false, maxScroll, moved: 0 };
        const originalTop = el.scrollTop;
        const testTarget = Math.min(originalTop + 300, maxScroll);
        el.scrollTop = testTarget;
        await wait(80);
        const actual = el.scrollTop;
        const moved = Math.abs(actual - originalTop);
        el.scrollTop = originalTop;
        await wait(40);
        return { el, ok: moved > 20, maxScroll, moved };
      }

      // Prefer containers wider than 40% of the viewport — that
      // filters out narrow sidebars on dashboard-style pages.
      let picked = null;
      let bestScore = -1;
      for (const el of candidates) {
        const r = await probe(el);
        if (!r.ok) continue;
        if (el.clientWidth < window.innerWidth * 0.4) continue;
        const score = r.maxScroll * el.clientWidth;
        if (score > bestScore) { bestScore = score; picked = el; }
      }
      // Fallback pass: relax the width filter if nothing passed.
      if (!picked) {
        for (const el of candidates) {
          const r = await probe(el);
          if (!r.ok) continue;
          const score = r.maxScroll * el.clientWidth;
          if (score > bestScore) { bestScore = score; picked = el; }
        }
      }

      /* ---- 3. Nothing scrolls ---- */
      if (!picked) {
        const dataUrl = await captureVisible();
        if (!dataUrl) throw new Error("no scroll container and no capture");
        resolve({ dataUrl, exceeded: false });
        return;
      }

      const container = picked;
      const isWindow =
        container === docEl ||
        container === document.documentElement ||
        container === document.body;

      const viewW = isWindow ? window.innerWidth  : container.clientWidth;
      const viewH = isWindow ? window.innerHeight : container.clientHeight;
      const scale = window.devicePixelRatio || 1;

      /* ---- 4. Neutralize sticky/fixed ---- */
      const undoFixed = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed" || cs.position === "sticky") {
          undoFixed.push({
            el,
            position: el.style.position,
            top: el.style.top,
            left: el.style.left,
            zIndex: el.style.zIndex,
            visibility: el.style.visibility,
          });
          el.style.setProperty("position", "absolute", "important");
          el.style.setProperty("z-index", "-1", "important");
        }
      }

      /* ---- 5. Helpers ---- */
      const scrollTopNow = () =>
        isWindow ? (window.scrollY || docEl.scrollTop) : container.scrollTop;
      const scrollTo = (y) => {
        if (isWindow) window.scrollTo(0, y);
        else container.scrollTop = y;
      };
      const totalHeight = () =>
        isWindow
          ? Math.max(document.body.scrollHeight, docEl.scrollHeight)
          : container.scrollHeight;

      const origTop  = scrollTopNow();
      const origLeft = isWindow ? window.scrollX : container.scrollLeft;

      /* ---- 6. First slice ---- */
      scrollTo(0);
      for (let i = 0; i < 20; i++) {
        await wait(40);
        if (scrollTopNow() < 4) break;
      }
      await wait(SLICE_DELAY);

      let first = null;
      for (let i = 0; i < 4 && !first; i++) {
        first = await captureVisible();
        if (!first) await wait(SLICE_DELAY);
      }
      if (!first) throw new Error("first slice failed");

      let lastHash = hashFrame(first);

      let totalH = totalHeight();
      const exceeded = false;

      const canvas = document.createElement("canvas");
      canvas.width  = Math.max(1, viewW * scale);
      canvas.height = Math.max(1, totalH * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      {
        const img = await loadImage(first);
        const drawH = Math.min(viewH, totalH) * scale;
        ctx.drawImage(img, 0, 0, img.width, drawH, 0, 0, img.width, drawH);
      }

      /* ---- 7. Loop ---- */
      let y = viewH;
      let safety = 0;
      let stable = 0;
      let prevH = totalHeight();

      while (y < totalH && safety++ < 500) {
        scrollTo(y);

        let reached = false;
        for (let i = 0; i < 25; i++) {
          await wait(40);
          if (Math.abs(scrollTopNow() - y) < 4) { reached = true; break; }
        }
        if (!reached) {
          console.warn("[CPT] cannot scroll to", y, "— stopping");
          break;
        }

        await wait(SLICE_DELAY);

        let dataUrl = null;
        for (let attempt = 0; attempt < MAX_RETRIES_PER_SLICE; attempt++) {
          const candidate = await captureVisible();
          if (!candidate) { await wait(SLICE_DELAY_RETRY); continue; }
          const h = hashFrame(candidate);
          if (h === lastHash) { await wait(SLICE_DELAY_RETRY); continue; }
          dataUrl = candidate;
          lastHash = h;
          break;
        }

        if (!dataUrl) {
          console.warn("[CPT] identical frames at y =", y, "— stopping");
          break;
        }

        const nowH = totalHeight();
        if (nowH > totalH) {
          totalH = nowH;
          canvas.height = Math.max(1, totalH * scale);
          stable = 0;
        } else if (nowH === prevH) {
          stable++;
        } else {
          stable = 0;
        }
        prevH = nowH;

        const img = await loadImage(dataUrl);
        const remaining = totalH - y;
        const sliceCssH = Math.min(viewH, remaining);
        const slicePxH = sliceCssH * scale;
        ctx.drawImage(img, 0, 0, img.width, slicePxH, 0, y * scale, img.width, slicePxH);

        const atBottom = scrollTopNow() + viewH >= totalHeight() - 4;
        if (atBottom && stable >= STABLE_PASSES) break;

        y += viewH;
      }

      /* ---- 8. Restore ---- */
      for (const { el, position, top, left, zIndex, visibility } of undoFixed) {
        el.style.position = position;
        el.style.top = top;
        el.style.left = left;
        el.style.zIndex = zIndex;
        el.style.visibility = visibility;
      }
      if (isWindow) window.scrollTo(origLeft, origTop);
      else container.scrollTop = origTop;

      resolve({ dataUrl: canvas.toDataURL("image/png"), exceeded });
    } catch (e) {
      reject(e);
    }
  });
}

/* =========================================================
 *  Message bus
 *  Public messages (no auth): CAPTURE_VISIBLE, CPT_DOWNLOAD_DATAURL,
 *  CPT_WRITE_CLIPBOARD, CPT_OPEN_WELCOME, CPT_GET_MAX_HEIGHT,
 *  CPT_GET_AUTH_STATE, CPT_SIGN_OUT.
 *  All other messages require a session.
 * ========================================================= */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /* ---------- Public ---------- */

  if (msg.type === "CAPTURE_VISIBLE") {
    chrome.tabs.captureVisibleTab(
      sender.tab.windowId,
      { format: "png" },
      (dataUrl) => sendResponse({ dataUrl })
    );
    return true;
  }

  if (msg.type === "CPT_DOWNLOAD_DATAURL") {
    chrome.downloads.download(
      {
        url: msg.dataUrl,
        filename: msg.filename || `screenshot-${Date.now()}.png`,
        saveAs: true,
      },
      (id) => sendResponse({ id })
    );
    return true;
  }

    if (msg.type === "CPT_START_PICKER") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) { sendResponse({ ok: false }); return; }
      const resp = await sendToTabSafe(tab.id, { type: "CPT_START_PICKER" });
      sendResponse(resp || { ok: true });
    })();
    return true;
  }

  if (msg.type === "CPT_START_INNER_CAPTURE") {
    (async () => {
      if (!(await requireAuth("inner-capture"))) {
        sendResponse({ ok: false, error: "not_signed_in" });
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) { sendResponse({ ok: false }); return; }

      const { maxHeight = DEFAULT_MAX_HEIGHT } = await chrome.storage.local.get("maxHeight");
      const cap = Math.min(Math.max(1000, maxHeight | 0), MAX_HEIGHT_HARD);

      const resp = await sendToTabSafe(tab.id, {
        type: "CPT_CAPTURE_BY_MARKER",
        marker: msg.marker,
        cap,
      });

      if (!resp || !resp.ok || !resp.dataUrl) {
        notifyError("Inner capture failed");
        sendResponse({ ok: false });
        return;
      }

      const key = "shot:" + Date.now();
      await chrome.storage.session.set({ [key]: resp.dataUrl });

      const qs =
        "?key=" + encodeURIComponent(key) +
        "&src=" + encodeURIComponent(tab.url || "") +
        "&method=inner" +
        "&exceeded=0";
      chrome.tabs.create({ url: chrome.runtime.getURL("screenshot.html") + qs });

      sendResponse({ ok: true });
    })();
    return true;
  }
if (msg.type === "CPT_WRITE_CLIPBOARD" && typeof msg.text === "string") {
    writeClipboard(msg.text).then((ok) => sendResponse({ ok }));
    return true;
  }

  if (msg.type === "CPT_OPEN_WELCOME") {
    openWelcomePage();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "CPT_GET_AUTH_STATE") {
    getSession().then((s) =>
      sendResponse({ signedIn: !!(s && s.token), user: s && s.user, issuedAt: s && s.issuedAt })
    );
    return true;
  }

  if (msg.type === "CPT_SIGN_OUT") {
    Promise.all([
      chrome.storage.session.remove(SESSION_KEY),
      chrome.storage.local.remove(SESSION_KEY),
    ]).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "CPT_GET_MAX_HEIGHT") {
    chrome.storage.local.get("maxHeight").then(({ maxHeight = DEFAULT_MAX_HEIGHT }) =>
      sendResponse({ maxHeight })
    );
    return true;
  }

  /* ---------- Extract preview (auth-gated) ---------- */

  if (msg.type === "CPT_OPEN_EXTRACT") {
    (async () => {
      if (!(await requireAuth("open-extract"))) {
        sendResponse({ ok: false, error: "not_signed_in" });
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || tab.id == null) {
        sendResponse({ ok: false, error: "no active tab" });
        return;
      }
      const ok = await openExtractPreview(tab);
      sendResponse({ ok });
    })();
    return true;
  }

  /* ---------- Protected ---------- */

  if (PROTECTED_MESSAGES.has(msg.type)) {
    (async () => {
      if (!(await requireAuth(msg.type))) {
        sendResponse({ ok: false, error: "not_signed_in" });
        return;
      }

      if (msg.type === "CPT_TRIGGER_SHOT") {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (tab && tab.id != null) {
            captureFullPage(tab).then(() => sendResponse({ ok: true }));
          } else {
            sendResponse({ ok: false, error: "no active tab" });
          }
        });
        return;
      }

      /* Forward content-script messages */
      if (
        sender.tab && sender.tab.id != null &&
        ["HL_", "CPT_"].some((p) => msg.type.startsWith(p))
      ) {
        const resp = await sendToTabSafe(sender.tab.id, msg);
        sendResponse(resp || { ok: true });
        return;
      }

      /* Set max height is authenticated but not tab-bound */
      if (msg.type === "CPT_SET_MAX_HEIGHT") {
        const v = Math.min(Math.max(1000, msg.value | 0), MAX_HEIGHT_HARD);
        await chrome.storage.local.set({ maxHeight: v });
        sendResponse({ ok: true, maxHeight: v });
        return;
      }

      sendResponse({ ok: false, error: "unsupported" });
    })();
    return true;
  }

  /* CPT_SET_MAX_HEIGHT is also protected but doesn't come from a tab */
  if (msg.type === "CPT_SET_MAX_HEIGHT") {
    (async () => {
      if (!(await requireAuth("set-max-height"))) {
        sendResponse({ ok: false, error: "not_signed_in" });
        return;
      }
      const v = Math.min(Math.max(1000, msg.value | 0), MAX_HEIGHT_HARD);
      await chrome.storage.local.set({ maxHeight: v });
      sendResponse({ ok: true, maxHeight: v });
    })();
    return true;
  }

  return false;
});

/* =========================================================
 *  Clipboard bridge
 * ========================================================= */

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}

  try {
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["CLIPBOARD"],
        justification: "Copy text on behalf of the user",
      });
    }
    const resp = await chrome.runtime.sendMessage({ type: "OFFSCREEN_COPY", text });
    return !!(resp && resp.ok);
  } catch (e) {
    console.error("[CPT] clipboard failed:", e);
    return false;
  }
}

/* =========================================================
 *  Badge helper
 * ========================================================= */

function notifyError(text) {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#c92a2a" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 3000);
  console.warn("[CPT]", text);
}




/* Self-heal: force unlimited height on every service worker start */
chrome.storage.local.set({ maxHeight: 999999999 }).catch(() => {});



