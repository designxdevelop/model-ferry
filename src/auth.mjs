import { execFile } from "node:child_process";
import { Cursor } from "@cursor/sdk";

export async function authStatus() {
  if (process.env.CURSOR_API_KEY?.trim()) {
    return { status: "logged-in", via: "env" };
  }
  const status = await Cursor.auth.status();
  if (status.status === "logged-in") {
    return { status: "logged-in", via: "sdk", email: status.email, apiKeyExpiresAtMs: status.apiKeyExpiresAtMs };
  }
  return { status: "logged-out" };
}

export async function login(options = {}) {
  const result = await Cursor.auth.login({
    apiKeyName: "Model Ferry",
    // Never let the SDK spawn xdg-open itself: on headless or remote machines
    // it hangs silently until the login times out with no URL shown. We print
    // the URL ourselves and best-effort open a browser so every user can
    // complete the sign-in.
    openBrowser: false,
    onLoginUrl: (url) => {
      console.log(`Model Ferry needs you to sign in with Cursor. Opening a browser tab…\nIf it does not open, visit this URL to complete sign-in:\n\n  ${url}\n`);
      openBrowser(url);
    },
    ...options
  });
  return { status: "logged-in", via: "browser-login", email: result.email };
}

function openBrowser(url) {
  try {
    if (process.platform === "darwin") execFile("/usr/bin/open", [url], () => {});
    else if (process.platform === "win32") execFile("cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], () => {});
    else execFile("xdg-open", [url], () => {});
  } catch {}
}

export function needsRenewal(auth, renewMs) {
  if (auth.status !== "logged-in" || auth.via === "env") return false;
  return Boolean(auth.apiKeyExpiresAtMs && auth.apiKeyExpiresAtMs - Date.now() < renewMs);
}

export async function logout() {
  await Cursor.auth.logout();
}
