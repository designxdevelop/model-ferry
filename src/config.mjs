import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const configDir = path.join(os.homedir(), ".config", "cursor-composer-bridge");
export const configPath = path.join(configDir, "config.json");
export const credentialPath = path.join(configDir, "credentials");
export const launchAgentPath = path.join(os.homedir(), "Library", "LaunchAgents", "ai.dxd.cursor-composer-bridge.plist");
export const openCodeConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");

export const defaults = {
  host: "127.0.0.1",
  port: 8791,
  localToken: "cursor-local",
  maxSessions: 64,
  requestTimeoutMs: 240_000,
  models: ["composer-2.5", "composer-2.5-fast", "grok-4.5", "grok-4.5-fast"]
};

export function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {}
  return {
    ...defaults,
    ...stored,
    host: process.env.COMPOSER_BRIDGE_HOST || stored.host || defaults.host,
    port: Number(process.env.COMPOSER_BRIDGE_PORT || stored.port || defaults.port)
  };
}

export function loadCursorApiKey() {
  if (process.env.CURSOR_API_KEY?.trim()) return process.env.CURSOR_API_KEY.trim();
  try {
    const raw = fs.readFileSync(credentialPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^CURSOR_API_KEY=(.*)$/);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  } catch {}
  return "";
}

export function ensurePrivateDirectory() {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
}

export function writePrivateFile(file, content) {
  ensurePrivateDirectory();
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
