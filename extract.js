/* =========================================================
 *  extract.js — structured text preview
 * ========================================================= */
(() => {
  const params = new URLSearchParams(location.search);
  const key = params.get("key");
  const src = params.get("src") || "(unknown)";

  const els = {
    src: document.getElementById("src"),
    stats: document.getElementById("stats"),
    loading: document.getElementById("loading"),
    blocks: document.getElementById("blocks"),
    status: document.getElementById("status"),
    includeImages: document.getElementById("include-images"),
    includeLinks: document.getElementById("include-links"),
  };

  els.src.textContent = src;
  let data = null;

  load();

  async function load() {
    if (!key) return fail("Missing key");
    const obj = await chrome.storage.session.get(key);
    data = obj[key];
    if (!data || !data.blocks) return fail("Extraction data expired.");
    els.stats.textContent =
      data.blocks.length + " blocks · " + (data.title ? data.title.slice(0, 40) : "untitled");
    els.loading.hidden = true;
    els.blocks.hidden = false;
    render();
  }

  function fail(msg) {
    els.loading.textContent = msg;
    els.loading.style.color = "var(--danger)";
  }

  function render() {
    els.blocks.innerHTML = "";
    data.blocks.forEach((b, i) => {
      if (b.kind === "image" && !els.includeImages.checked) return;
      if (b.kind === "link" && !els.includeLinks.checked) return;
      els.blocks.appendChild(renderBlock(b, i));
    });
  }

  function renderBlock(b, index) {
    const el = document.createElement("div");
    el.className = "block " + b.kind;

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.textContent = "copy";
    copyBtn.title = "Copy just this block";
    copyBtn.addEventListener("click", async () => {
      await copyBlock(b);
      el.classList.add("copied");
      setTimeout(() => el.classList.remove("copied"), 900);
      els.status.textContent = "Copied block " + (index + 1);
    });
    el.appendChild(copyBtn);

    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = b.kind;
    el.appendChild(kind);

    if (b.kind === "heading") {
      const h = document.createElement("h" + b.level);
      h.textContent = b.text;
      el.appendChild(h);
    } else if (b.kind === "link") {
      const a = document.createElement("a");
      a.href = b.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = b.text;
      el.appendChild(a);
      const small = document.createElement("div");
      small.style.marginTop = "4px";
      small.style.fontSize = "12px";
      small.style.color = "var(--muted)";
      small.style.wordBreak = "break-all";
      small.textContent = b.href;
      el.appendChild(small);
    } else if (b.kind === "image") {
      const img = document.createElement("img");
      img.src = b.src;
      img.alt = b.alt || "";
      img.loading = "lazy";
      el.appendChild(img);
      const body = document.createElement("div");
      body.className = "body";
      body.textContent = b.alt || b.title || b.src;
      el.appendChild(body);
    } else if (b.kind === "code") {
      const pre = document.createElement("pre");
      pre.className = "body";
      pre.textContent = b.text;
      el.appendChild(pre);
    } else {
      const div = document.createElement("div");
      div.className = "body";
      div.textContent = b.text;
      el.appendChild(div);
    }
    return el;
  }

  async function copyToClipboard(text) {
    const resp = await chrome.runtime.sendMessage({
      type: "CPT_WRITE_CLIPBOARD",
      text,
    });
    return !!(resp && resp.ok);
  }

  async function copyBlock(b) {
    if (b.kind === "link") {
      await copyToClipboard(b.text + "\n" + b.href);
    } else if (b.kind === "image") {
      await copyToClipboard("![" + (b.alt || "image") + "](" + b.src + ")");
    } else {
      await copyToClipboard(b.text);
    }
  }

  function blocksToPlainText() {
    const lines = [];
    for (const b of data.blocks) {
      if (b.kind === "image" && !els.includeImages.checked) continue;
      if (b.kind === "link" && !els.includeLinks.checked) continue;
      switch (b.kind) {
        case "heading":   lines.push(b.text.toUpperCase()); break;
        case "paragraph": lines.push(b.text); break;
        case "link":      lines.push(b.text + " — " + b.href); break;
        case "list-item": lines.push("• " + b.text); break;
        case "quote":     lines.push("> " + b.text); break;
        case "code":      lines.push(b.text); break;
        case "caption":   lines.push(b.text); break;
        case "image":     lines.push("[Image: " + (b.alt || b.src) + "]"); break;
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  function blocksToMarkdown() {
    const lines = [];
    for (const b of data.blocks) {
      if (b.kind === "image" && !els.includeImages.checked) continue;
      if (b.kind === "link" && !els.includeLinks.checked) continue;
      switch (b.kind) {
        case "heading":   lines.push("#".repeat(b.level) + " " + b.text); break;
        case "paragraph": lines.push(b.text); break;
        case "link":      lines.push("[" + b.text + "](" + b.href + ")"); break;
        case "list-item": lines.push("- " + b.text); break;
        case "quote":     lines.push("> " + b.text); break;
        case "code":      lines.push("```\n" + b.text + "\n```"); break;
        case "caption":   lines.push("*" + b.text + "*"); break;
        case "image":     lines.push("![" + (b.alt || "image") + "](" + b.src + ")"); break;
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  function blocksToJson() {
    return JSON.stringify({
      url: data.url, title: data.title, timestamp: data.timestamp,
      blockCount: data.blocks.length, blocks: data.blocks,
    }, null, 2);
  }

  document.getElementById("copy-plain").addEventListener("click", async () => {
    const ok = await copyToClipboard(blocksToPlainText());
    els.status.textContent = ok ? "Copied as text" : "Copy failed";
  });
  document.getElementById("copy-md").addEventListener("click", async () => {
    const ok = await copyToClipboard(blocksToMarkdown());
    els.status.textContent = ok ? "Copied as Markdown" : "Copy failed";
  });
  document.getElementById("copy-json").addEventListener("click", async () => {
    const ok = await copyToClipboard(blocksToJson());
    els.status.textContent = ok ? "Copied as JSON" : "Copy failed";
  });
  document.getElementById("download").addEventListener("click", () => {
    const text = blocksToPlainText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: "extracted-" + Date.now() + ".txt",
      saveAs: true,
    });
  });
  document.getElementById("discard").addEventListener("click", () => window.close());
  els.includeImages.addEventListener("change", render);
  els.includeLinks.addEventListener("change", render);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      const sel = window.getSelection();
      if (!sel || !sel.toString().length) {
        e.preventDefault();
        document.getElementById("copy-md").click();
      }
    }
  });
})();