export const onboardingPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Model Ferry</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0d1117; color: #e6edf3; display: grid; place-items: center; min-height: 100vh; }
  .card { width: min(480px, 92vw); background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8b949e; font-size: 13px; margin-bottom: 24px; }
  .status { border: 1px solid #30363d; border-radius: 8px; padding: 12px 16px; font-size: 14px; margin-bottom: 20px; }
  .status .label { color: #8b949e; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
  button { appearance: none; border: none; border-radius: 8px; padding: 12px 16px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; }
  button.primary { background: #2f81f7; color: #fff; }
  button.ghost { background: transparent; color: #8b949e; border: 1px solid #30363d; margin-top: 12px; }
  button:disabled { opacity: .5; cursor: default; }
  .meta { color: #8b949e; font-size: 13px; line-height: 1.6; }
  .meta b { color: #e6edf3; }
  .error { color: #f85149; }
</style>
</head>
<body>
<div class="card">
  <h1>Model Ferry</h1>
  <div class="sub">Connect your Cursor account to OpenCode</div>
  <div class="status" id="status">Checking…</div>
  <button class="primary" id="signin" hidden>Sign in with Cursor</button>
  <button class="ghost" id="logout" hidden>Sign out</button>
  <div class="meta" id="meta"></div>
</div>
<script>
  const statusEl = document.getElementById("status");
  const metaEl = document.getElementById("meta");
  const signinBtn = document.getElementById("signin");
  const logoutBtn = document.getElementById("logout");
  let renewing = false;

  async function fetchState() {
    const res = await fetch("/v1/auth/status");
    return res.json();
  }

  async function refresh() {
    let state;
    try { state = await fetchState(); } catch { statusEl.textContent = "Bridge is not responding."; return; }
    renewing = Boolean(state.renewing);
    render(state);
  }

  function render(state) {
    if (state.status === "logged-in") {
      const who = state.email ? escapeHtml(state.email) : "Your Cursor account";
      const expires = state.apiKeyExpiresAtMs ? " · renews automatically before " + new Date(state.apiKeyExpiresAtMs).toLocaleDateString() : "";
      statusEl.innerHTML = '<div class="label">Signed in</div>' + who + expires;
      signinBtn.hidden = true;
      logoutBtn.hidden = false;
      metaEl.innerHTML = state.ready
        ? "<b>" + (state.catalog && state.catalog.models) + "</b> models ready. Open OpenCode and select the <b>Cursor</b> provider."
        : "Signed in. Fetching the model catalog…";
    } else {
      statusEl.innerHTML = renewing
        ? '<div class="label">Waiting for sign-in</div>Complete the login in the tab that just opened. This page updates automatically.'
        : '<div class="label">Not signed in</div>Sign in to bring Cursor models into OpenCode.';
      signinBtn.hidden = renewing;
      logoutBtn.hidden = true;
      metaEl.innerHTML = "";
    }
  }

  signinBtn.addEventListener("click", async () => {
    try { await fetch("/v1/auth/login", { method: "POST" }); } catch {}
    renewing = true;
    render(await fetchState());
  });

  logoutBtn.addEventListener("click", async () => {
    await fetch("/v1/auth/logout", { method: "POST" });
    refresh();
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
