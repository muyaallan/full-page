/* =========================================================
})();

/* ---------- 0. Auth awareness ---------- */
let signedIn = false;

async function refreshAuthState() {
  try {
    const mem = await chrome.storage.session.get(SESSION_KEY).catch(() => ({}));
    const loc = await chrome.storage.local.get(SESSION_KEY);
    const s = mem[SESSION_KEY] || loc[SESSION_KEY] || null;
    signedIn = !!(s && s.token);
  } catch {
    signedIn = false;
  }

  if (!signedIn) {
    try {
      const { "cpt:signedIn": flag } = await chrome.storage.local.get("cpt:signedIn");
      signedIn = !!flag;
    } catch {}
  }

  if (!signedIn) {
    setUnlock(false);
    hideChip();
  } else {
    setUnlock(true);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" && area !== "local") return;
  const sChanged = changes[SESSION_KEY];
  const flagChanged = changes["cpt:signedIn"];
  if (!sChanged && !flagChanged) return;

  if (sChanged) {
    const v = sChanged.newValue;
    signedIn = !!(v && v.token);
  } else if (flagChanged) {
    signedIn = !!flagChanged.newValue;
  }

  if (!signedIn) { setUnlock(false); hideChip(); }
  else setUnlock(true);
});
/* =========================================================
 *  Copy-Proof Tools — content script (v2.1.0)
 *  Adds structured text extraction (headings, paragraphs,
 *  links, lists, quotes, code, images) with preview.
 * ========================================================= */
(() => {
  if (window.__CPT_LOADED__) return;
  window.__CPT_LOADED__ = true;

  const HL_CLASS   = "__hl";
  const HL_ID      = "data-hl-id";
  const CONTEXT_LEN = 32;
  const SESSION_KEY = "cpt:session";

  /* ---------- 0. Auth awareness ---------- */
  let signedIn = false;

  async function refreshAuthState() {
    try {
      const mem = await chrome.storage.session.get(SESSION_KEY);
      const loc = await chrome.storage.local.get(SESSION_KEY);
      const s = mem[SESSION_KEY] || loc[SESSION_KEY] || null;
      signedIn = !!(s && s.token);
    } catch {
      signedIn = false;
    }
    if (!signedIn) {
      setUnlock(false);
      hideChip();
    } else {
      setUnlock(true);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === "session" || area === "local") && changes[SESSION_KEY]) {
      const v = changes[SESSION_KEY].newValue;
      signedIn = !!(v && v.token);
      if (!signedIn) { setUnlock(false); hideChip(); }
      else setUnlock(true);
    }
  });

  /* ---------- 1. Copy-protection override ---------- */
  const STEALTH_CLASS = "cpt_" + Math.random().toString(36).slice(2, 9);
  const shadowHost = document.createElement("div");
  shadowHost.setAttribute(
    "style",
    "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;"
  );
  const shadow = shadowHost.attachShadow({ mode: "closed" });
  const styleEl = document.createElement("style");
  styleEl.textContent = `.${STEALTH_CLASS}, .${STEALTH_CLASS} * {
    -webkit-user-select: text !important; user-select: text !important;
    -webkit-user-drag: auto !important; pointer-events: auto !important;
  }`;
  shadow.appendChild(styleEl);
  document.documentElement.appendChild(shadowHost);

  const EVENTS = ["copy", "cut", "contextmenu", "selectstart", "dragstart"];
  const swallow = (e) => {
    if (window.__cptUnlocked && signedIn) e.stopImmediatePropagation();
  };

  function setUnlock(on) {
    if (on && signedIn) {
      document.documentElement.classList.add(STEALTH_CLASS);
      for (const ev of EVENTS) {
        window.removeEventListener(ev, swallow, true);
        window.addEventListener(ev, swallow, { capture: true, passive: true });
      }
    } else {
      document.documentElement.classList.remove(STEALTH_CLASS);
      for (const ev of EVENTS) window.removeEventListener(ev, swallow, true);
    }
    window.__cptUnlocked = !!(on && signedIn);
  }

  /* ---------- 2. Storage ---------- */
  const storageKey = () => `hl:${location.origin + location.pathname}`;
  async function loadQuotes() {
    const obj = await chrome.storage.local.get(storageKey());
    return obj[storageKey()] || [];
  }
  async function saveQuote(q) {
    const list = await loadQuotes();
    list.push(q);
    await chrome.storage.local.set({ [storageKey()]: list });
  }
  async function updateQuote(id, patch) {
    const list = await loadQuotes();
    const i = list.findIndex((q) => q.id === id);
    if (i === -1) return;
    list[i] = { ...list[i], ...patch };
    await chrome.storage.local.set({ [storageKey()]: list });
  }
  async function removeQuote(id) {
    const list = await loadQuotes();
    await chrome.storage.local.set({ [storageKey()]: list.filter((q) => q.id !== id) });
  }
  async function clearAll() {
    await chrome.storage.local.remove(storageKey());
  }

  /* ---------- 3. Text-quote helpers ---------- */
  function approxOffsetOfRangeStart(range) {
    const pre = document.createRange();
    pre.selectNodeContents(document.body);
    try { pre.setEnd(range.startContainer, range.startOffset); } catch { return 0; }
    return pre.toString().length;
  }
  function serializeRange(range) {
    const text = range.toString();
    if (!text.trim()) return null;
    const full = document.body.innerText || "";
    const start = approxOffsetOfRangeStart(range);
    return {
      id: (crypto.randomUUID && crypto.randomUUID()) || "id-" + Math.random().toString(36).slice(2),
      text,
      prefix: full.slice(Math.max(0, start - CONTEXT_LEN), start),
      suffix: full.slice(start + text.length, start + text.length + CONTEXT_LEN),
      color: "yellow",
      pinned: false,
      left: null, top: null,
      url: location.href,
      createdAt: Date.now(),
    };
  }
  function findRange(quote) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return NodeFilter.FILTER_REJECT;
        if (p.closest(`mark.${HL_CLASS}`)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    let full = "";
    let n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: full.length });
      full += n.nodeValue;
    }
    let idx = -1;
    const withCtx = quote.prefix + quote.text + quote.suffix;
    if (withCtx.length > quote.text.length) {
      const w = full.indexOf(withCtx);
      if (w !== -1) idx = w + quote.prefix.length;
    }
    if (idx === -1) idx = full.indexOf(quote.text);
    if (idx === -1) return null;
    const end = idx + quote.text.length - 1;
    const s = locate(nodes, idx);
    const e = locate(nodes, end);
    if (!s || !e) return null;
    const r = document.createRange();
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, e.offset + 1);
    return r;
  }
  function locate(nodes, off) {
    let lo = 0, hi = nodes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cur = nodes[mid];
      const next = nodes[mid + 1];
      const curEnd = next ? next.start : Infinity;
      if (off < cur.start) hi = mid - 1;
      else if (off >= curEnd) lo = mid + 1;
      else return { node: cur.node, offset: off - cur.start };
    }
    return null;
  }
  function wrapRange(range, quote) {
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) if (range.intersectsNode(n)) textNodes.push(n);
    const marks = [];
    for (const node of textNodes) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end   = node === range.endContainer   ? range.endOffset   : node.nodeValue.length;
      if (start >= end) continue;
      const selected = node.nodeValue.slice(start, end);
      const before   = node.nodeValue.slice(0, start);
      const after    = node.nodeValue.slice(end);
      const mark = document.createElement("mark");
      mark.className = HL_CLASS;
      mark.setAttribute(HL_ID, quote.id);
      mark.dataset.color = quote.color;
      mark.textContent = selected;
      const parent = node.parentNode;
      if (before) parent.insertBefore(document.createTextNode(before), node);
      parent.insertBefore(mark, node);
      if (after) parent.insertBefore(document.createTextNode(after), node);
      parent.removeChild(node);
      marks.push(mark);
    }
    return marks;
  }

  /* ---------- 4. Highlight lifecycle ---------- */
  async function highlightSelection(color = "yellow") {
    if (!signedIn) { toast("Sign in to highlight"); return false; }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      toast("Nothing selected");
      return false;
    }
    const range = sel.getRangeAt(0);
    const quote = serializeRange(range);
    if (!quote) return false;
    quote.color = color;
    wrapRange(range, quote);
    await saveQuote(quote);
    sel.removeAllRanges();
    toast("Highlighted");
    return true;
  }
  async function restoreAll() {
    if (!signedIn) return;
    const quotes = await loadQuotes();
    for (const q of quotes) {
      if (document.querySelector(`mark.${HL_CLASS}[${HL_ID}="${q.id}"]`)) continue;
      if (document.querySelector(`.__hl-pin[data-hl-id="${q.id}"]`)) continue;
      if (q.pinned) renderPinned(q);
      else {
        const range = findRange(q);
        if (range) wrapRange(range, q);
      }
    }
  }
  async function deleteHighlight(id) {
    if (!signedIn) return;
    document.querySelectorAll(`mark.${HL_CLASS}[${HL_ID}="${id}"]`).forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    document.querySelectorAll(`.__hl-pin[data-hl-id="${id}"]`).forEach((el) => el.remove());
    await removeQuote(id);
    hideToolbar();
  }

  /* ---------- 5. Hover toolbar ---------- */
  const toolbar = document.createElement("div");
  toolbar.className = "__hl-toolbar";
  toolbar.innerHTML = `
    <span class="swatch" data-color="yellow" style="background:#ffe066"></span>
    <span class="swatch" data-color="green"  style="background:#b2f2bb"></span>
    <span class="swatch" data-color="blue"   style="background:#a5d8ff"></span>
    <span class="swatch" data-color="pink"   style="background:#ffc9de"></span>
    <span class="swatch" data-color="orange" style="background:#ffd8a8"></span>
    <button data-action="pin" title="Detach & pin">📌</button>
    <button data-action="delete" title="Delete">🗑</button>
  `;
  let hoveredId = null;
  let hoveredMarks = [];
  function showToolbar(marks) {
    if (!signedIn) return;
    hoveredMarks = marks;
    hoveredId = marks[0].getAttribute(HL_ID);
    const r = marks[0].getBoundingClientRect();
    toolbar.style.left = `${window.scrollX + r.left}px`;
    toolbar.style.top  = `${window.scrollY + r.top - 44}px`;
    toolbar.classList.add("visible");
  }
  function hideToolbar() {
    toolbar.classList.remove("visible");
    hoveredId = null;
    hoveredMarks = [];
  }
  document.body.appendChild(toolbar);

  document.addEventListener("mouseover", (e) => {
    if (!signedIn) return;
    const mark = e.target.closest && e.target.closest(`mark.${HL_CLASS}`);
    if (!mark) return;
    const id = mark.getAttribute(HL_ID);
    showToolbar([...document.querySelectorAll(`mark.${HL_CLASS}[${HL_ID}="${id}"]`)]);
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest(`mark.${HL_CLASS}`)) {
      setTimeout(() => {
        if (!toolbar.matches(":hover") && !document.querySelector(`mark.${HL_CLASS}:hover`)) hideToolbar();
      }, 120);
    }
  });
  toolbar.addEventListener("click", async (e) => {
    const swatch = e.target.closest(".swatch");
    if (swatch) {
      const color = swatch.dataset.color;
      hoveredMarks.forEach((m) => (m.dataset.color = color));
      await updateQuote(hoveredId, { color });
      return;
    }
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.action === "delete") await deleteHighlight(hoveredId);
    if (btn.dataset.action === "pin") await pinHighlight(hoveredId, hoveredMarks);
  });

  /* ---------- 6. Pinning & drag ---------- */
  function colorToHex(c) {
    return { yellow:"#ffe066", green:"#b2f2bb", blue:"#a5d8ff", pink:"#ffc9de", orange:"#ffd8a8" }[c] || "#ffe066";
  }
  async function pinHighlight(id, marks) {
    if (!marks || !marks.length) return;
    const first = marks[0];
    const rect = first.getBoundingClientRect();
    const text = marks.map((m) => m.textContent).join("");
    const color = first.dataset.color || "yellow";
    marks.forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    const pin = document.createElement("div");
    pin.className = `__hl-pin ${HL_CLASS}`;
    pin.dataset.hlId = id;
    pin.dataset.color = color;
    pin.textContent = text;
    pin.style.left = `${window.scrollX + rect.left}px`;
    pin.style.top  = `${window.scrollY + rect.top}px`;
    pin.style.background = colorToHex(color);
    document.body.appendChild(pin);
    await updateQuote(id, { pinned: true, left: window.scrollX + rect.left, top: window.scrollY + rect.top });
    makeDraggable(pin, id);
    hideToolbar();
  }
  function renderPinned(q) {
    const pin = document.createElement("div");
    pin.className = `__hl-pin ${HL_CLASS}`;
    pin.dataset.hlId = q.id;
    pin.dataset.color = q.color;
    pin.textContent = q.text;
    pin.style.left = `${q.left}px`;
    pin.style.top  = `${q.top}px`;
    pin.style.background = colorToHex(q.color);
    document.body.appendChild(pin);
    makeDraggable(pin, q.id);
  }
  function makeDraggable(el, id) {
    let sx, sy, ol, ot, dragging = false;
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      sx = e.pageX; sy = e.pageY;
      const r = el.getBoundingClientRect();
      ol = window.scrollX + r.left; ot = window.scrollY + r.top;
      el.style.cursor = "grabbing";
      e.preventDefault(); e.stopPropagation();
    });
    const move = (e) => {
      if (!dragging) return;
      el.style.left = `${ol + e.pageX - sx}px`;
      el.style.top  = `${ot + e.pageY - sy}px`;
    };
    const up = async () => {
      if (!dragging) return;
      dragging = false;
      el.style.cursor = "grab";
      await updateQuote(id, {
        pinned: true,
        left: parseInt(el.style.left, 10) || 0,
        top:  parseInt(el.style.top, 10) || 0,
      });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  document.addEventListener("mousedown", (e) => {
    if (!signedIn) return;
    const mark = e.target.closest && e.target.closest(`mark.${HL_CLASS}`);
    if (!mark || e.button !== 0) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length) return;
    const id = mark.getAttribute(HL_ID);
    const marks = [...document.querySelectorAll(`mark.${HL_CLASS}[${HL_ID}="${id}"]`)];
    const sx = e.pageX, sy = e.pageY;
    let moved = false;
    const onMove = (ev) => {
      if (!moved && Math.hypot(ev.pageX - sx, ev.pageY - sy) > 6) {
        moved = true;
        pinHighlight(id, marks);
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  /* ---------- 7. Toast ---------- */
  let toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "__cpt-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("visible");
    clearTimeout(toastEl.__t);
    toastEl.__t = setTimeout(() => toastEl.classList.remove("visible"), 1600);
  }

  /* ---------- 8. Text extraction ---------- */
  function extractSelection() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : "";
    if (!text) return null;
    return { type:"text", source:"selection", text, url: location.href, title: document.title, timestamp: Date.now() };
  }
  function extractArticle() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(
      "script, style, noscript, svg, canvas, iframe, " +
      "nav, footer, aside, header, form, button, " +
      "[role=banner], [role=navigation], [role=complementary], " +
      "[aria-hidden=true], .ad, .ads, .advert, [class*=cookie], [class*=consent]"
    ).forEach((el) => el.remove());
    const candidates = [];
    function score(el) {
      if (!el.children || el.children.length === 0) return;
      const text = (el.innerText || "").trim();
      if (!text) return;
      const linkText = [...el.querySelectorAll("a")].reduce((n, a) => n + (a.innerText || "").length, 0);
      const paragraphs = el.querySelectorAll("p").length;
      const headings = el.querySelectorAll("h1,h2,h3").length;
      const punct = (text.match(/[.,;:!?]/g) || []).length;
      const s = text.length + paragraphs * 200 + headings * 100 + punct * 5 - linkText * 2;
      candidates.push({ text, score: s });
      for (const c of el.children) score(c);
    }
    score(clone);
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const text = (best ? best.text : clone.innerText || "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) return null;
    return { type:"text", source:"article", text, url: location.href, title: document.title, timestamp: Date.now() };
  }
  function extractFullPage() {
    const text = (document.body.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return null;
    return { type:"text", source:"page", text, url: location.href, title: document.title, timestamp: Date.now() };
  }

  /* ---------- 8b. STRUCTURED EXTRACTION ---------- */
  function extractStructured() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll(
      "script, style, noscript, svg, canvas, iframe, " +
      "nav, footer, aside, header, form, button, " +
      "[role=banner], [role=navigation], [role=complementary], " +
      "[aria-hidden=true], .ad, .ads, .advert, [class*=cookie], [class*=consent]"
    ).forEach((el) => el.remove());

    const blocks = [];
    const seen = new Set();
    function clean(s) { return (s || "").replace(/\s+/g, " ").trim(); }
    function pushBlock(kind, payload) {
      const key = kind + ":" + JSON.stringify(payload).slice(0, 200);
      if (seen.has(key)) return;
      seen.add(key);
      blocks.push({ kind, ...payload });
    }

    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        const tag = node.tagName;
        if (/^(H1|H2|H3|H4|H5|H6|P|A|LI|BLOCKQUOTE|PRE|IMG|FIGCAPTION)$/.test(tag)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const tag = node.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const text = clean(node.innerText);
        if (text) pushBlock("heading", { level: parseInt(tag[1], 10), text });
        continue;
      }
      if (tag === "P") {
        const text = clean(node.innerText);
        if (!text) continue;
        const links = node.querySelectorAll("a");
        if (links.length === 1 && clean(links[0].innerText) === text) continue;
        pushBlock("paragraph", { text });
        continue;
      }
      if (tag === "A") {
        if (node.closest("p")) continue;
        const text = clean(node.innerText);
        const href = node.getAttribute("href") || "";
        if (!text || !href) continue;
        pushBlock("link", { text, href });
        continue;
      }
      if (tag === "LI") {
        const text = clean(node.innerText);
        if (!text) continue;
        pushBlock("list-item", { text });
        continue;
      }
      if (tag === "BLOCKQUOTE") {
        const text = clean(node.innerText);
        if (text) pushBlock("quote", { text });
        continue;
      }
      if (tag === "PRE") {
        const text = node.innerText || "";
        if (text.trim()) pushBlock("code", { text });
        continue;
      }
      if (tag === "IMG") {
        const src = node.currentSrc || node.src || "";
        const alt = node.alt || "";
        if (src && !src.startsWith("data:")) {
          pushBlock("image", { src, alt, title: node.title || "" });
        }
        continue;
      }
      if (tag === "FIGCAPTION") {
        const text = clean(node.innerText);
        if (text) pushBlock("caption", { text });
        continue;
      }
    }

    return {
      type: "structured",
      source: "page",
      url: location.href,
      title: document.title,
      timestamp: Date.now(),
      blockCount: blocks.length,
      blocks,
    };
  }

  function structuredToText(data) {
    if (!data || !data.blocks) return "";
    const lines = [];
    for (const b of data.blocks) {
      switch (b.kind) {
        case "heading":    lines.push("#".repeat(b.level) + " " + b.text); break;
        case "paragraph":  lines.push(b.text); break;
        case "link":       lines.push(b.text + " — " + b.href); break;
        case "list-item":  lines.push("• " + b.text); break;
        case "quote":      lines.push("> " + b.text); break;
        case "code":       lines.push("```\n" + b.text + "\n```"); break;
        case "caption":    lines.push("_" + b.text + "_"); break;
        case "image":      lines.push("![" + (b.alt || "image") + "](" + b.src + ")"); break;
      }
      lines.push("");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function copyUndetectable(text) {
    if (!text) return false;

    // 1. Direct clipboard write from the content script.
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}

    // 2. Legacy execCommand fallback.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) return true;
    } catch (_) {}

    // 3. SW / offscreen bridge.
    try {
      const resp = await chrome.runtime.sendMessage({ type: "CPT_WRITE_CLIPBOARD", text });
      return !!(resp && resp.ok);
    } catch (_) {
      return false;
    }
  }

  async function copyObject(obj) {
    if (!obj || !obj.text) return false;
    return copyUndetectable(obj.text);
  }
  async function copySelectionOrArticle() {
    const sel = extractSelection();
    if (sel) { await copyObject(sel); toast("Copied selection"); return true; }
    const art = extractArticle();
    if (art) { await copyObject(art); toast("Copied article text"); return true; }
    const full = extractFullPage();
    if (full) { await copyObject(full); toast("Copied page text"); return true; }
    toast("Nothing to copy");
    return false;
  }
  async function copyArticleOnly() {
    const art = extractArticle();
    if (!art) { toast("No article found"); return false; }
    const ok = await copyUndetectable(art.text);
    toast(ok ? "Copied article text" : "Copy failed");
    return ok;
  }
  async function copyFullPage() {
    const full = extractFullPage();
    if (!full) { toast("Nothing to copy"); return false; }
    const ok = await copyUndetectable(full.text);
    toast(ok ? "Copied page text" : "Copy failed");
    return ok;
  }

  /* ---------- 9. Selection chip ---------- */
  const chip = document.createElement("div");
  chip.className = "__cpt-chip";
  chip.setAttribute("data-role", "selection-chip");
  chip.innerHTML = `
    <button data-action="copy">Copy</button>
    <button data-action="highlight">Highlight</button>
    <button data-action="article">Article</button>
    <button data-action="drag" title="Drag or copy to clipboard">⇅</button>
  `;
  chip.style.display = "none";
  document.body.appendChild(chip);
  function hideChip() { chip.style.display = "none"; }

  let chipTimer = null;
  document.addEventListener("selectionchange", () => {
    clearTimeout(chipTimer);
    if (!signedIn) { chip.style.display = "none"; return; }
    chipTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { chip.style.display = "none"; return; }
      const text = sel.toString().trim();
      if (text.length < 2) { chip.style.display = "none"; return; }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) { chip.style.display = "none"; return; }
      chip.style.left = `${window.scrollX + rect.left + rect.width / 2}px`;
      chip.style.top  = `${window.scrollY + rect.top - 42}px`;
      chip.style.display = "flex";
      chip.dataset.text = text;
    }, 160);
  });

  const dragHandle = chip.querySelector('[data-action="drag"]');
  dragHandle.setAttribute("draggable", "true");
  dragHandle.addEventListener("dragstart", (e) => {
    if (!signedIn) { e.preventDefault(); return; }
    const text = chip.dataset.text || "";
    if (!text) return;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", text);
    chrome.runtime.sendMessage({ type: "CPT_WRITE_CLIPBOARD", text });
    toast("Dragging — clipboard also set");
  });

  chip.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "copy") {
      const sel = extractSelection();
      if (sel) { await copyObject(sel); toast("Copied selection"); }
      chip.style.display = "none";
    } else if (action === "highlight") {
      await highlightSelection("yellow");
      chip.style.display = "none";
    } else if (action === "article") {
      await copyArticleOnly();
      chip.style.display = "none";
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!chip.contains(e.target)) chip.style.display = "none";
  });

  /* ---------- 10. Message API ---------- */
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "HL_HIGHLIGHT") {
      highlightSelection(msg.color).then((ok) => sendResponse({ ok }));
      return true;
    }
    if (msg.type === "HL_RESTORE") {
      restoreAll().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "HL_CLEAR") {
      document.querySelectorAll(`mark.${HL_CLASS}, .__hl-pin`).forEach((m) => {
        const parent = m.parentNode;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
      });
      clearAll().then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "HL_LIST") {
      loadQuotes().then((list) => sendResponse({ list }));
      return true;
    }
    if (msg.type === "HL_DELETE") {
      deleteHighlight(msg.id).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg.type === "HL_SCROLL_TO") {
      const mark = document.querySelector(
        `mark.${HL_CLASS}[${HL_ID}="${msg.id}"], .__hl-pin[data-hl-id="${msg.id}"]`
      );
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
        mark.animate(
          [{ outline: "3px solid #ffe066" }, { outline: "3px solid transparent" }],
          { duration: 1200, easing: "ease-out" }
        );
        sendResponse({ ok: true });
      } else sendResponse({ ok: false });
      return true;
    }
    if (msg.type === "CPT_TOGGLE_UNLOCK") {
      setUnlock(!window.__cptUnlocked);
      sendResponse({ ok: true, unlocked: window.__cptUnlocked });
      return true;
    }
    if (msg.type === "CPT_GET_STATE") {
      sendResponse({ unlocked: !!window.__cptUnlocked, signedIn });
      return true;
    }
    if (msg.type === "CPT_SET_UNLOCK") {
      setUnlock(!!msg.value);
      sendResponse({ ok: true, unlocked: window.__cptUnlocked });
      return true;
    }
    if (msg.type === "CPT_COPY_PLAIN") {
      copySelectionOrArticle().then((ok) => sendResponse({ ok }));
      return true;
    }
    if (msg.type === "CPT_COPY_SELECTION") {
      const sel = extractSelection();
      if (!sel) { sendResponse({ ok: false }); return true; }
      copyObject(sel).then((ok) => sendResponse({ ok }));
      return true;
    }
    if (msg.type === "CPT_COPY_ARTICLE") {
      copyArticleOnly().then((ok) => sendResponse({ ok }));
      return true;
    }
    if (msg.type === "CPT_COPY_PAGE_TEXT") {
      copyFullPage().then((ok) => sendResponse({ ok }));
      return true;
    }
    if (msg.type === "CPT_EXTRACT_STRUCTURED") {
      const data = extractStructured();
      sendResponse({ ok: true, data });
      return true;
    }
    if (msg.type === "CPT_COPY_STRUCTURED") {
      const data = msg.data || extractStructured();
      const text = structuredToText(data);
      copyUndetectable(text).then((ok) => {
        sendResponse({ ok });
        if (ok) toast("Copied " + data.blockCount + " blocks");
      });
      return true;
    }
    if (msg.type === "CPT_REFRESH_AUTH") {
      refreshAuthState().then(() => {
        sendResponse({ ok: true, signedIn });
        if (signedIn) restoreAll();
      });
      return true;
    }
    return false;
  });

  /* ---------- 11. Init ---------- */
  (async () => {
    await refreshAuthState();
    if (signedIn) {
      setUnlock(true);
      restoreAll();
    }
  })();

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (signedIn) restoreAll();
    }
  }).observe(document.body, { childList: true, subtree: true });

  /* =========================================================
   * 12. INNER SCROLLER PICKER
   *     Highlights scrollable containers on the page and lets
   *     the user pick one. The SW then runs the stitcher against
   *     that specific element.
   * ======================================================= */

  function startScrollerPicker() {
    // If already running, abort.
    if (window.__cptPickerRunning) return;
    window.__cptPickerRunning = true;

    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483645;pointer-events:none;";
    document.documentElement.appendChild(overlay);

    const label = document.createElement("div");
    label.style.cssText =
      "position:fixed;z-index:2147483647;background:#1f2330;color:#fff;" +
      "font:12px ui-monospace,monospace;padding:6px 10px;border-radius:6px;" +
      "pointer-events:none;border:1px solid #3a3f52;box-shadow:0 4px 12px rgba(0,0,0,.4);" +
      "white-space:nowrap;";
    document.documentElement.appendChild(label);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel (Esc)";
    cancelBtn.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#1f2330;color:#fff;border:1px solid #3a3f52;font:13px system-ui,sans-serif;" +
      "padding:8px 14px;border-radius:8px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.4);";
    document.documentElement.appendChild(cancelBtn);

    // Find all scrollable containers.
    const candidates = [];
    document.querySelectorAll("*").forEach((el) => {
      if (!(el instanceof Element)) return;
      if (el === overlay || el === label || el === cancelBtn) return;
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return;
      const range = el.scrollHeight - el.clientHeight;
      if (range < 80) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 200 || rect.height < 200) return;
      candidates.push(el);
    });

    if (candidates.length === 0) {
      cleanup();
      return;
    }

    // Draw a rect for each candidate.
    const rectEls = [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;pointer-events:none;" +
        `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
        "border:2px dashed #ffe066;background:rgba(255,224,102,.05);" +
        "z-index:2147483646;border-radius:4px;transition:background .15s,border-color .15s;";
      overlay.appendChild(box);
      rectEls.push({ el, box });
    }

    function labelFor(el) {
      const rect = el.getBoundingClientRect();
      const range = el.scrollHeight - el.clientHeight;
      const slices = Math.ceil(el.scrollHeight / el.clientHeight);
      const tag = el.tagName.toLowerCase();
      const id = el.id ? "#" + el.id : "";
      const cls = el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
      return `${tag}${id}${cls} · ${Math.round(rect.width)}×${Math.round(el.scrollHeight)}px · ${slices} slices`;
    }

    let hovered = null;
    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      let best = null;
      for (const c of candidates) {
        if (c === el || c.contains(el)) { best = c; break; }
      }
      if (best !== hovered) {
        rectEls.forEach(({ el, box }) => {
          if (el === best) {
            box.style.background = "rgba(255,224,102,.15)";
            box.style.borderColor = "#fff";
          } else {
            box.style.background = "rgba(255,224,102,.05)";
            box.style.borderColor = "#ffe066";
          }
        });
        hovered = best;
      }
      if (hovered) {
        label.textContent = labelFor(hovered);
        label.style.left = Math.min(e.clientX + 12, window.innerWidth - 260) + "px";
        label.style.top = Math.max(12, e.clientY - 32) + "px";
        label.style.display = "block";
      } else {
        label.style.display = "none";
      }
    }

    async function onClick(e) {
      if (!hovered) return;
      e.preventDefault();
      e.stopPropagation();

      const picked = hovered;
      cleanup();

      // Ask SW to capture this specific element.
      try {
        await chrome.runtime.sendMessage({
          type: "CPT_CAPTURE_ELEMENT",
          // We can't pass a DOM node; we'll use a data attribute tag.
        });
      } catch (_) {}

      // The SW will re-inject a script that tags this element and
      // runs the stitcher on it. To make that possible, store a
      // reference marker on the element itself.
      const marker = "__cpt_picked_" + Date.now();
      picked.dataset.__cptPickerMarker = marker;

      // Notify the SW with the marker so it can find it after re-inject.
      chrome.runtime.sendMessage({
        type: "CPT_START_INNER_CAPTURE",
        marker,
      });
    }

    function onKey(e) {
      if (e.key === "Escape") cleanup();
    }

    function cleanup() {
      window.__cptPickerRunning = false;
      overlay.remove();
      label.remove();
      cancelBtn.remove();
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("scroll", () => {}, true);
    }

    cancelBtn.addEventListener("click", cleanup);
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
  }

  // Listen for the start-picker message.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "CPT_START_PICKER") {
      try {
        startScrollerPicker();
        sendResponse({ ok: true });
      } catch (e) {
        console.error("[CPT] picker failed:", e);
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }

    if (msg.type === "CPT_CAPTURE_BY_MARKER") {
      // SW re-injected us with a marker — find the element and capture.
      const marker = msg.marker;
      const target = document.querySelector(`[data-__cpt-picker-marker="${marker}"]`);
      if (!target) {
        sendResponse({ ok: false, error: "marker_not_found" });
        return true;
      }
      captureElement(target, msg.cap).then((result) => {
        target.removeAttribute("data-__cpt-picker-marker");
        sendResponse(result);
      });
      return true;
    }
  });

  /* -----------------------------------------------------------
   * Capture a specific scrollable element by scrolling it and
   * stitching. Similar to the SW's stitcher but targets one
   * element directly.
   * --------------------------------------------------------- */
  async function captureElement(target, cap) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const SLICE_DELAY = 600;
    const SLICE_DELAY_RETRY = 1000;
    const MAX_RETRIES = 5;

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

    const rect = target.getBoundingClientRect();
    const viewH = target.clientHeight;
    const viewW = target.clientWidth;
    const scale = window.devicePixelRatio || 1;
    const origTop = target.scrollTop;

    // Canvas sized to the container's full scrollable height.
    const totalH = Math.min(target.scrollHeight, cap || target.scrollHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, viewW * scale);
    canvas.height = Math.max(1, totalH * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Scroll to top.
    target.scrollTop = 0;
    await wait(SLICE_DELAY);

    let lastHash = "";

    let y = 0;
    let safety = 0;
    while (y < totalH && safety++ < 500) {
      target.scrollTop = y;
      for (let i = 0; i < 20; i++) {
        await wait(40);
        if (Math.abs(target.scrollTop - y) < 4) break;
      }
      await wait(SLICE_DELAY);

      let dataUrl = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const c = await captureVisible();
        if (!c) { await wait(SLICE_DELAY_RETRY); continue; }
        const h = hashFrame(c);
        if (h === lastHash) { await wait(SLICE_DELAY_RETRY); continue; }
        dataUrl = c;
        lastHash = h;
        break;
      }
      if (!dataUrl) {
        console.warn("[CPT] inner-scroll: identical frames at y =", y, "— stopping");
        break;
      }

      const img = await loadImage(dataUrl);
      const remaining = totalH - y;
      const sliceH = Math.min(viewH, remaining);
      const slicePxH = sliceH * scale;

      // Draw only the part of the viewport that corresponds to the
      // container. The container's visible area is at rect.top of the
      // captured viewport (in CSS pixels).
      const cropTop = Math.max(0, Math.round(rect.top)) * scale;
      ctx.drawImage(
        img,
        0, cropTop,
        img.width, slicePxH,
        0, y * scale,
        img.width, slicePxH
      );

      y += viewH;

      const atBottom = target.scrollTop + viewH >= target.scrollHeight - 4;
      if (atBottom) break;
    }

    // Restore
    target.scrollTop = origTop;

    return {
      ok: true,
      dataUrl: canvas.toDataURL("image/png"),
    };
  }

})();
