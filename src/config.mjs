import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const configDir = path.join(os.homedir(), ".config", "modelferry");
export const configPath = path.join(configDir, "config.json");
export const catalogPath = path.join(configDir, "catalog.json");
export const launchAgentPath = path.join(os.homedir(), "Library", "LaunchAgents", "ai.dxd.modelferry.plist");
export const openCodeConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");

export const defaults = {
  host: "127.0.0.1",
  port: 8791,
  localToken: "cursor-local",
  maxSessions: 64,
  requestTimeoutMs: 240_000,
  catalogRefreshMs: 6 * 60 * 60 * 1000,
  loginRenewMs: 3 * 24 * 60 * 60 * 1000,
  loginTimeoutMs: 5 * 60 * 1000,
  exposeVariantAliases: false,
  stripSystemPrompt: true
};

export function loadConfig() {
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {}
  return {
    ...defaults,
    ...stored,
    host: process.env.MODELFERRY_HOST || stored.host || defaults.host,
    port: Number(process.env.MODELFERRY_PORT || stored.port || defaults.port)
  };
}

export function ensurePrivateDirectory() {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
}

export function writePrivateFile(file, content) {
  ensurePrivateDirectory();
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

export function updateConfig(patch) {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
  const next = { ...stored, ...patch };
  writePrivateFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
