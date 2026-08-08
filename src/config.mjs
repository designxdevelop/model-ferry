import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const configDir = path.join(os.homedir(), ".config", "modelferry");
export const configPath = path.join(configDir, "config.json");
export const catalogPath = path.join(configDir, "catalog.json");
export const launchAgentPath = path.join(os.homedir(), "Library", "LaunchAgents", "ai.dxd.modelferry.plist");
export const openCodeConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");

/** Well-known token from early installs — migrated away on ensure. */
export const LEGACY_LOCAL_TOKEN = "cursor-local";

export const defaults = {
  host: "127.0.0.1",
  port: 8791,
  maxSessions: 64,
  requestTimeoutMs: 240_000,
  catalogRefreshMs: 6 * 60 * 60 * 1000,
  loginRenewMs: 3 * 24 * 60 * 60 * 1000,
  loginTimeoutMs: 5 * 60 * 1000,
  exposeVariantAliases: false,
  stripSystemPrompt: true
};

export function createLocalToken() {
  return crypto.randomBytes(24).toString("hex");
}

export function readStoredConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Merge stored config with defaults. Mint a random localToken when missing or
 * still set to the legacy public default. Does not wipe user overrides.
 */
export function ensureConfig() {
  ensurePrivateDirectory();
  const stored = readStoredConfig();
  const next = { ...defaults, ...stored };
  const needsToken = !stored.localToken || stored.localToken === LEGACY_LOCAL_TOKEN;
  if (needsToken) next.localToken = createLocalToken();
  const missingKeys = Object.keys(defaults).some((key) => stored[key] === undefined);
  if (needsToken || missingKeys || !fs.existsSync(configPath)) {
    writePrivateFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  }
  return loadConfig();
}

export function loadConfig() {
  const stored = readStoredConfig();
  return {
    ...defaults,
    ...stored,
    localToken: stored.localToken || LEGACY_LOCAL_TOKEN,
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
  const stored = readStoredConfig();
  const next = { ...stored, ...patch };
  writePrivateFile(configPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
