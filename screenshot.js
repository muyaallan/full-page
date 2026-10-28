/* =========================================================
 *  Preview page logic
 * ========================================================= */
(() => {
  const params = new URLSearchParams(location.search);
  const key = params.get("key");
  const src = params.get("src") || "(unknown)";
  const method = params.get("method") || "—";

  const imgEl = document.getElementById("shot");
  const loadingEl = document.getElementById("loading");
  const dimsEl = document.getElementById("dims");
  const methodEl = document.getElementById("method");
  const srcEl = document.getElementById("src");

  srcEl.textContent = src;
  methodEl.textContent = method === "cdp" ? "CDP" : "Stitched";

  let dataUrl = null;
  const filename = `screenshot-${Date.now()}.png`;

  load();

  async function load() {
    if (!key) return fail("Missing screenshot key.");
    const obj = await chrome.storage.session.get(key);
    dataUrl = obj[key];
    if (!dataUrl) return fail("Screenshot data expired or missing.");

    imgEl.onload = () => {
      loadingEl.hidden = true;
      imgEl.hidden = false;
      dimsEl.textContent = `${imgEl.naturalWidth} × ${imgEl.naturalHeight}`;
      setZoom("fit");
    };
    imgEl.onerror = () => fail("Failed to render image.");
    imgEl.src = dataUrl;
  }

  function fail(msg) {
    loadingEl.textContent = msg;
    loadingEl.style.color = "var(--danger)";
  }

  document.getElementById("save").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "CPT_DOWNLOAD_DATAURL",
      dataUrl,
      filename,
    });
  });

  document.getElementById("copy").addEventListener("click", async () => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      flash("Copied to clipboard");
    } catch (e) {
      flash("Copy failed");
    }
  });

  document.getElementById("discard").addEventListener("click", () => {
    window.close();
  });

  document.querySelectorAll(".zoom button").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelectorAll(".zoom button").forEach((x) => {
        x.classList.toggle("active", x === b);
      });
      setZoom(b.dataset.z);
    });
  });

  function setZoom(z) {
    if (z === "fit") {
      imgEl.style.maxWidth = "100%";
      imgEl.style.width = "";
      imgEl.style.height = "";
    } else {
      imgEl.style.maxWidth = "none";
      imgEl.style.width = imgEl.naturalWidth * parseFloat(z) + "px";
      imgEl.style.height = "auto";
    }
  }

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      document.getElementById("save").click();
    }
    if (e.key === "Escape") window.close();
  });

  let toastEl;
  function flash(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      Object.assign(toastEl.style, {
        position: "fixed",
        bottom: "80px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--panel)",
        color: "var(--text)",
        border: "1px solid var(--line)",
        padding: "8px 14px",
        borderRadius: "8px",
        font: "13px system-ui, sans-serif",
        zIndex: 99999,
        opacity: "0",
        transition: "opacity .2s",
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastEl.__t);
    toastEl.__t = setTimeout(() => (toastEl.style.opacity = "0"), 1500);
  }
})();