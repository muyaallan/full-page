/* =========================================================
 *  ads.js — house promos that link out to MAKE ENT STUDIO.
 *
 *  Chrome extensions cannot legally run AdSense, and MV3 CSP
 *  blocks external ad scripts anyway. Instead, we show small
 *  promo cards that open the studio site in a new tab — where
 *  AdSense runs legally via your existing ads.txt.
 * ========================================================= */

(function () {
  const STUDIO_URL = "https://makeent.netlify.app";

  const PROMOS = [
    {
      title: "MAKE ENT STUDIO",
      body: "Remote creative technology studio",
      cta: "Visit studio",
      url: STUDIO_URL,
    },
    {
      title: "Blog",
      body: "Editing tips, motion design breakdowns",
      cta: "Read blog",
      url: STUDIO_URL + "/blog",
    },
    {
      title: "Shop",
      body: "Presets, LUTs, and sound packs",
      cta: "Browse shop",
      url: STUDIO_URL + "/shop",
    },
    {
      title: "Newsletter",
      body: "Get updates on new presets and articles",
      cta: "Subscribe",
      url: STUDIO_URL + "/subscribe",
    },
    {
      title: "Pricing & Billing",
      body: "How work is priced and how billing works",
      cta: "View pricing",
      url: STUDIO_URL + "/help/pricing-and-billing",
    },
    {
      title: "Contact",
      body: "Questions or custom work?",
      cta: "Get in touch",
      url: STUDIO_URL + "/contact",
    },
  ];

  // Rotate starting index per page load so multiple slots show variety.
  const startIndex = Math.floor(Math.random() * PROMOS.length);
  let promoIndex = startIndex;

  function mount() {
    document.querySelectorAll(".ad-slot").forEach((el) => {
      if (el.dataset.mounted) return;
      el.dataset.mounted = "1";

      const promo = PROMOS[promoIndex % PROMOS.length];
      promoIndex++;

      el.innerHTML = "";
      el.style.display = "flex";
      el.style.alignItems = "center";
      el.style.gap = "14px";
      el.style.padding = "14px 16px";
      el.style.border = "1px solid rgba(255,255,255,.1)";
      el.style.borderRadius = "12px";
      el.style.background = "rgba(255,255,255,.03)";
      el.style.font = "13px system-ui, -apple-system, sans-serif";
      el.style.textAlign = "left";
      el.style.minHeight = "60px";
      el.style.color = "inherit";

      const left = document.createElement("div");
      left.style.flex = "1";
      left.style.minWidth = "0";

      const title = document.createElement("div");
      title.textContent = promo.title;
      title.style.fontWeight = "600";
      title.style.marginBottom = "2px";
      title.style.fontSize = "13.5px";

      const body = document.createElement("div");
      body.textContent = promo.body;
      body.style.opacity = ".65";
      body.style.fontSize = "12px";
      body.style.overflow = "hidden";
      body.style.textOverflow = "ellipsis";
      body.style.whiteSpace = "nowrap";

      left.appendChild(title);
      left.appendChild(body);

      const cta = document.createElement("a");
      cta.href = promo.url;
      cta.target = "_blank";
      cta.rel = "noopener noreferrer";
      cta.textContent = promo.cta;
      cta.style.textDecoration = "none";
      cta.style.padding = "8px 14px";
      cta.style.borderRadius = "8px";
      cta.style.background = "#ffe066";
      cta.style.color = "#1a1a1a";
      cta.style.fontWeight = "600";
      cta.style.whiteSpace = "nowrap";
      cta.style.fontSize = "12.5px";
      cta.style.transition = "filter .15s";
      cta.addEventListener("mouseenter", () => (cta.style.filter = "brightness(1.08)"));
      cta.addEventListener("mouseleave", () => (cta.style.filter = ""));

      el.appendChild(left);
      el.appendChild(cta);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();