/* =========================================================
 *  auth.js — shared session helpers
 *  Talks to Supabase Edge Functions on project
 *  qqhncavvhkdqzpfudzoy.supabase.co
 * ========================================================= */

const CPT_AUTH = (() => {
  const SESSION_KEY = "cpt:session";
  const API_BASE = "https://qqhncavvhkdqzpfudzoy.supabase.co/functions/v1";
  const PUBLISHABLE_KEY = "sb_publishable_7AMuypCrQxh1v8GsCaidRQ_zO7eNUtS";

  // Headers Supabase's gateway requires on every call.
  const baseHeaders = {
    "Content-Type": "application/json",
    "apikey": PUBLISHABLE_KEY,
  };

  async function getSession() {
    const inSession = await chrome.storage.session.get(SESSION_KEY);
    if (inSession[SESSION_KEY]) return inSession[SESSION_KEY];

    const inLocal = await chrome.storage.local.get(SESSION_KEY);
    const sess = inLocal[SESSION_KEY] || null;
    if (sess) {
      await chrome.storage.session.set({ [SESSION_KEY]: sess });
    }
    return sess;
  }

  async function setSession(session) {
    await chrome.storage.session.set({ [SESSION_KEY]: session });
    if (session && session.remember) {
      await chrome.storage.local.set({ [SESSION_KEY]: session });
    } else if (!session) {
      await chrome.storage.local.remove(SESSION_KEY);
    }
  }

  async function clearSession() {
    await chrome.storage.session.remove(SESSION_KEY);
    await chrome.storage.local.remove(SESSION_KEY);
  }

  async function isSignedIn() {
    const s = await getSession();
    return !!(s && s.token);
  }

  async function requestMagicLink(email, returnUrl) {
    const resp = await fetch(`${API_BASE}/auth-magic-link`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ email, returnUrl }),
    });
    if (!resp.ok) throw new Error(await safeText(resp));
    return resp.json();
  }

  async function verifyToken(token) {
    const resp = await fetch(`${API_BASE}/auth-session`, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ token }),
    });
    if (!resp.ok) throw new Error(await safeText(resp));
    return resp.json();
  }

  async function signOut() {
    const s = await getSession();
    if (s && s.token) {
      try {
        await fetch(`${API_BASE}/auth-sign-out`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify({ token: s.token }),
        });
      } catch (_) {}
    }
    await clearSession();
  }

  async function safeText(resp) {
    try { return await resp.text(); } catch { return `${resp.status}`; }
  }

  return {
    API_BASE,
    getSession,
    setSession,
    clearSession,
    isSignedIn,
    requestMagicLink,
    verifyToken,
    signOut,
  };
})();