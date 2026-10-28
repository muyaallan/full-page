/* =========================================================
 *  welcome.js — sign-in flow and session display
 * ========================================================= */

const els = {
  signinCard:  document.getElementById("signinCard"),
  signedIn:    document.getElementById("signedInCard"),
  form:        document.getElementById("signinForm"),
  email:       document.getElementById("email"),
  remember:    document.getElementById("remember"),
  sendBtn:     document.getElementById("sendBtn"),
  status:      document.getElementById("status"),
  avatar:      document.getElementById("avatar"),
  displayName: document.getElementById("displayName"),
  displayEmail:document.getElementById("displayEmail"),
  signOut:     document.getElementById("signOutBtn"),
  dashboard:   document.getElementById("openDashboard"),
};

init();

async function init() {
  const session = await CPT_AUTH.getSession();

  if (session && session.token) {
    // Already signed in — go straight to the dashboard.
    location.replace(chrome.runtime.getURL("dashboard.html"));
    return;
  }

  renderSignedOut();
  els.form.addEventListener("submit", onSend);

  if (els.signOut) els.signOut.addEventListener("click", onSignOut);
  if (els.dashboard) {
    els.dashboard.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    });
  }
}

function renderSignedOut() {
  if (els.signinCard) els.signinCard.style.display = "block";
  if (els.signedIn) els.signedIn.classList.remove("on");
}

function setStatus(text, kind) {
  if (!els.status) return;
  els.status.textContent = text;
  els.status.className = "status" + (kind ? " " + kind : "");
}

async function onSend(e) {
  e.preventDefault();
  const email = (els.email.value || "").trim();
  if (!email) return;

  els.sendBtn.disabled = true;
  setStatus("Sending your sign-in link…");

  try {
    // The magic link redirects back to auth-callback.html#token=...
    // auth-callback.js saves the session and forwards to dashboard.html.
    const returnUrl = chrome.runtime.getURL("auth-callback.html");
    await CPT_AUTH.requestMagicLink(email, returnUrl);

    await chrome.storage.local.set({ "cpt:remember": els.remember.checked });

    setStatus(
      `Check your inbox — we sent a sign-in link to ${email}. Open it in this browser to finish.`,
      "ok"
    );
  } catch (err) {
    console.error("[welcome] magic-link failed:", err);
    setStatus(`Couldn't send the link. ${err.message || ""}`, "err");
  } finally {
    els.sendBtn.disabled = false;
  }
}

async function onSignOut() {
  await CPT_AUTH.signOut();
  renderSignedOut();
  setStatus("Signed out. Sign in again to use Copy-Proof Tools.");
}