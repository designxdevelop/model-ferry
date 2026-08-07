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
  const result = await Cursor.auth.login({ apiKeyName: "Model Ferry", ...options });
  return { status: "logged-in", via: "browser-login", email: result.email };
}

export function needsRenewal(auth, renewMs) {
  if (auth.status !== "logged-in" || auth.via === "env") return false;
  return Boolean(auth.apiKeyExpiresAtMs && auth.apiKeyExpiresAtMs - Date.now() < renewMs);
}

export async function logout() {
  await Cursor.auth.logout();
}
