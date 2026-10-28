/* auth-callback.js
 * The magic link lands here with #token=<session>.
 * Exchange it for a session, save it, then redirect to the dashboard.
 */
(async function () {
  const titleEl  = document.getElementById("title");
  const msgEl    = document.getElementById("msg");
  const spin     = document.getElementById("spin");
  const closeBtn = document.getElementById("closeBtn");

  function fail(text) {
    spin.style.display = "none";
    titleEl.textContent = "Sign-in failed";
    titleEl.className = "err";
    msgEl.textContent = text;
    closeBtn.style.display = "inline-block";
    closeBtn.addEventListener("click", () => window.close());
  }

  function ok(email) {
    spin.style.display = "none";
    titleEl.textContent = "You're signed in";
    titleEl.className = "ok";
    msgEl.innerHTML =
      `Signed in as <strong>${email}</strong>.<br>Opening your dashboard…`;
    // Short pause so the user sees the confirmation, then jump.
    setTimeout(() => {
      location.replace(chrome.runtime.getURL("dashboard.html"));
    }, 700);
  }

  try {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const token = params.get("token");
    if (!token) return fail("Missing token in the link.");

    const { remember } = await chrome.storage.local.get("cpt:remember");

    const resp = await CPT_AUTH.verifyToken(token);
    if (!resp || !resp.ok || !resp.user) return fail("Server rejected the token.");

    await CPT_AUTH.setSession({
      token,
      remember: !!remember,
      user: resp.user,
      issuedAt: Date.now(),
    });

    ok(resp.user.email || "your account");
  } catch (e) {
    console.error("[auth-callback]", e);
    fail(e.message || "Something went wrong.");
  }
})();