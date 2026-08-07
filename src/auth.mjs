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

export async function login() {
  const result = await Cursor.auth.login({ apiKeyName: "Model Ferry" });
  return { status: "logged-in", via: "browser-login", email: result.email };
}

export async function ensureAuthenticated() {
  const status = await authStatus();
  if (status.status === "logged-in") return status;
  console.error("\nModel Ferry needs your Cursor account.\nA browser will open to sign you in and mint a 90-day API key.\nTo skip the browser, set CURSOR_API_KEY and run setup again.\n");
  return login();
}

export async function logout() {
  await Cursor.auth.logout();
}
