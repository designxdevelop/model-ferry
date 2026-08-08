export function renderOnboardingPage(localToken) {
  return onboardingPageTemplate.replaceAll("__MODELFERRY_TOKEN__", JSON.stringify(localToken));
}

const onboardingPageTemplate = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Model Ferry</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0b0c; color: #f2f2f3; display: grid; place-items: center; padding: 24px; }
  body::before { content: ""; position: fixed; inset: 0; background: radial-gradient(1200px 600px at 50% -10%, rgba(110, 168, 255, 0.07), transparent 60%); pointer-events: none; }
  .wrap { width: min(440px, 100%); position: relative; }
  .mark { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .mark svg { display: block; }
  .mark .name { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
  .mark .tag { margin-left: auto; font-size: 12px; color: #8a8a92; letter-spacing: 0.04em; text-transform: uppercase; }
  .card { background: #141416; border: 1px solid #26262b; border-radius: 16px; padding: 28px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35); }
  .status { border: 1px solid #2a2a30; border-radius: 12px; padding: 16px 18px; font-size: 14px; line-height: 1.5; margin-bottom: 20px; background: #101012; }
  .status .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #6a6a72; margin-right: 8px; vertical-align: 1px; }
  .status.ready .dot { background: #4ade80; }
  .status .label { color: #8a8a92; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
  .status .who { font-weight: 600; }
  .status .note { color: #8a8a92; font-size: 12px; margin-top: 5px; line-height: 1.5; }
  button { appearance: none; border: none; border-radius: 10px; padding: 13px 16px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; font-family: inherit; transition: opacity 0.15s ease, transform 0.05s ease; }
  button.primary { background: #2f81f7; color: #fff; }
  button.primary:hover { background: #4b94f8; }
  button.primary:active { transform: translateY(1px); }
  button.ghost { background: transparent; color: #8a8a92; border: 1px solid #2a2a30; margin-top: 10px; }
  button.ghost:hover { color: #f2f2f3; border-color: #3a3a42; }
  button:disabled { opacity: 0.5; cursor: default; }
  .meta { color: #8a8a92; font-size: 13px; line-height: 1.6; margin-top: 16px; }
  .meta b { color: #f2f2f3; font-weight: 600; }
  .foot { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 24px; font-size: 12px; color: #6a6a72; }
  .foot a { color: #8a8a92; text-decoration: none; }
  .foot a:hover { color: #f2f2f3; }
  .legalese { text-align: center; margin-top: 10px; font-size: 10px; line-height: 1.6; color: #4c4c52; }
  .card.settings { margin-top: 16px; }
  .label { color: #8a8a92; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
  .row { display: flex; align-items: flex-start; gap: 16px; cursor: pointer; }
  .row .row-text { flex: 1; }
  .row-title { display: block; font-size: 14px; font-weight: 600; }
  .row-note { display: block; font-size: 12px; color: #8a8a92; line-height: 1.5; margin-top: 4px; }
  .row-note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: #1c1c20; padding: 1px 4px; border-radius: 4px; }
  input[type="checkbox"] { appearance: none; flex: none; width: 40px; height: 22px; margin: 2px 0 0; border-radius: 999px; background: #2a2a30; position: relative; cursor: pointer; transition: background 0.15s ease; }
  input[type="checkbox"]::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #f2f2f3; transition: transform 0.15s ease; }
  input[type="checkbox"]:checked { background: #2f81f7; }
  input[type="checkbox"]:checked::after { transform: translateX(18px); }
</style>
</head>
<body>
<div class="wrap">
  <div class="mark">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 17.5h18c.6 0 .9.7.5 1.1l-2 2c-.2.2-.5.4-.8.4H5.3c-.3 0-.6-.2-.8-.4l-2-2c-.4-.4-.1-1.1.5-1.1Z" fill="#2f81f7"/>
      <path d="M5 8l3-3h8l3 3" stroke="#f2f2f3" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 8h16v9.5H4V8Z" stroke="#f2f2f3" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M8 8v3m4-3v3m4-3v3" stroke="#8a8a92" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    <span class="name">Model Ferry</span>
    <span class="tag">Cursor &rarr; OpenCode</span>
  </div>
  <div class="card">
    <div class="status" id="status">Checking&hellip;</div>
    <button class="primary" id="signin" hidden>Sign in with Cursor</button>
    <button class="ghost" id="logout" hidden>Sign out</button>
    <div class="meta" id="meta"></div>
  </div>
  <div class="card settings" id="settingsCard" hidden>
    <div class="label">Bridge behavior</div>
    <label class="row">
      <span class="row-text">
        <span class="row-title">Strip the outer client&rsquo;s system prompt</span>
        <span class="row-note">Cursor agents already carry their own system prompt, so the outer client&rsquo;s system message is left out to avoid two competing prompts. OpenCode skills and <code>AGENTS.md</code> guidance are still forwarded to the model.</span>
      </span>
      <input type="checkbox" id="stripSystemPrompt" />
    </label>
  </div>
  <div class="foot">
    <span>Built by <a href="https://designxdevelop.com" target="_blank" rel="noopener">Design X Develop</a></span>
    <span class="sep">&middot;</span>
    <a href="https://github.com/designxdevelop/model-ferry" target="_blank" rel="noopener">GitHub</a>
  </div>
  <div class="legalese">Cursor, OpenCode, and all other trademarks are the property of their respective owners. Model Ferry is not affiliated with, sponsored, or endorsed by Anysphere, Inc. (Cursor) or Anomaly (OpenCode). All rights reserved.</div>
</div>
<script>
  const statusEl = document.getElementById("status");
  const metaEl = document.getElementById("meta");
  const signinBtn = document.getElementById("signin");
  const logoutBtn = document.getElementById("logout");
  const settingsCard = document.getElementById("settingsCard");
  const stripSystemPromptEl = document.getElementById("stripSystemPrompt");
  const localToken = __MODELFERRY_TOKEN__;
  const authHeaders = { authorization: "Bearer " + localToken };
  let renewing = false;

  async function fetchState() {
    const res = await fetch("/v1/auth/status", { headers: authHeaders });
    return res.json();
  }

  async function refresh() {
    let state;
    try { state = await fetchState(); } catch { setStatus('<span class="dot"></span>Bridge is not responding.', false); return; }
    renewing = Boolean(state.renewing);
    render(state);
  }

  function setStatus(html, ready) {
    statusEl.className = "status" + (ready ? " ready" : "");
    statusEl.innerHTML = html;
  }

  function render(state) {
    settingsCard.hidden = false;
    stripSystemPromptEl.checked = Boolean(state.stripSystemPrompt);
    if (state.status === "logged-in") {
      const who = state.email ? escapeHtml(state.email) : "Your Cursor account";
      const expires = state.apiKeyExpiresAtMs ? '<div class="note">Renews automatically before ' + new Date(state.apiKeyExpiresAtMs).toLocaleDateString() + "</div>" : "";
      setStatus('<span class="dot"></span><div class="label">Signed in</div><span class="who">' + who + "</span>" + expires, true);
      signinBtn.hidden = true;
      logoutBtn.hidden = false;
      metaEl.innerHTML = state.ready
        ? "<b>" + (state.catalog && state.catalog.models) + "</b> models ready. Open OpenCode and select the <b>Cursor</b> provider."
        : "Signed in. Fetching the model catalog&hellip;";
    } else {
      setStatus(renewing
        ? '<span class="dot"></span><div class="label">Waiting for sign-in</div>Complete the login in the tab that just opened. This page updates automatically.'
        : '<span class="dot"></span><div class="label">Not signed in</div>Sign in to bring Cursor models into OpenCode.', false);
      signinBtn.hidden = renewing;
      logoutBtn.hidden = true;
      metaEl.innerHTML = "Sign-in happens on Cursor&rsquo;s website. Your key appears as <b>Model Ferry</b> in the Cursor dashboard.";
    }
  }

  signinBtn.addEventListener("click", async () => {
    try { await fetch("/v1/auth/login", { method: "POST", headers: authHeaders }); } catch {}
    renewing = true;
    render(await fetchState());
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/v1/auth/logout", { method: "POST", headers: authHeaders });
    refresh();
  });

  stripSystemPromptEl.addEventListener("change", async () => {
    const target = stripSystemPromptEl.checked;
    try {
      const res = await fetch("/v1/config", {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders },
        body: JSON.stringify({ stripSystemPrompt: target })
      });
      if (!res.ok) throw new Error("config update failed");
      const body = await res.json();
      stripSystemPromptEl.checked = Boolean(body.stripSystemPrompt);
    } catch {
      stripSystemPromptEl.checked = !target;
    }
  });

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>
`;

