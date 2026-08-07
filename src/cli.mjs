#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  configPath,
  credentialPath,
  defaults,
  ensurePrivateDirectory,
  launchAgentPath,
  loadConfig,
  loadCursorApiKey,
  openCodeConfigPath,
  projectRoot,
  writePrivateFile
} from "./config.mjs";
import { buildRegistry, fetchCatalog, readCachedCatalog, syncOpenCodeConfig } from "./catalog.mjs";

const command = process.argv[2] || "help";
if (command === "setup") await setup();
else if (command === "status") await status();
else if (command === "refresh") await refresh();
else if (command === "models") await models();
else if (command === "uninstall") await uninstall();
else help();

async function setup() {
  ensurePrivateDirectory();
  const key = loadCursorApiKey() || migrateKeychainKey();
  if (!key) throw new Error("Could not read the existing API for Cursor key. Keep that app unlocked and rerun setup, or set CURSOR_API_KEY for this command.");
  writePrivateFile(credentialPath, `CURSOR_API_KEY=${key}\n`);
  writePrivateFile(configPath, `${JSON.stringify(defaults, null, 2)}\n`);
  const state = await fetchCatalog(key);
  const registry = buildRegistry(state.catalog);
  syncOpenCodeConfig(registry, defaults);
  installLaunchAgent();
  console.log(`Composer Bridge installed with ${registry.models.length} Cursor models and ${variantCount(registry)} variants.`);
  console.log("Your existing OpenCode default model was preserved.");
  console.log("Select the Cursor Models provider in OpenCode, then choose a model and variant.");
}

function migrateKeychainKey() {
  if (process.env.CURSOR_API_KEY?.trim()) return process.env.CURSOR_API_KEY.trim();
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password", "-w", "-s", "ai.standardagents.apiforcursor", "-a", "cursor-api-key"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function installLaunchAgent() {
  fs.mkdirSync(path.dirname(launchAgentPath), { recursive: true });
  const node = process.execPath;
  const server = path.join(projectRoot, "src", "server.mjs");
  const logDir = path.join(os.homedir(), "Library", "Logs", "ComposerBridge");
  fs.mkdirSync(logDir, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>ai.dxd.cursor-composer-bridge</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(server)}</string></array>
  <key>WorkingDirectory</key><string>${xml(projectRoot)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, "stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, "stderr.log"))}</string>
</dict></plist>\n`;
  fs.writeFileSync(launchAgentPath, plist);
  const domain = `gui/${process.getuid()}`;
  try { execFileSync("/bin/launchctl", ["bootout", domain, launchAgentPath], { stdio: "ignore" }); } catch {}
  execFileSync("/bin/launchctl", ["bootstrap", domain, launchAgentPath]);
  execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/ai.dxd.cursor-composer-bridge`]);
}

async function status() {
  const config = loadConfig();
  try {
    const response = await fetch(`http://${config.host}:${config.port}/health`);
    console.log(JSON.stringify(await response.json(), null, 2));
  } catch {
    console.error("Composer Bridge is not responding.");
    process.exitCode = 1;
  }
}

async function refresh() {
  const config = loadConfig();
  try {
    const response = await fetch(`http://${config.host}:${config.port}/v1/catalog/refresh`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.localToken}` }
    });
    if (!response.ok) throw new Error(`bridge returned ${response.status}`);
    const body = await response.json();
    console.log(`Cursor catalog refreshed: ${body.catalog.models} models, ${body.catalog.variants} variants${body.changed ? " (updated)" : " (unchanged)"}.`);
    return;
  } catch {}
  const key = loadCursorApiKey();
  if (!key) throw new Error("Cursor API key is not configured. Run: npm run setup");
  const state = await fetchCatalog(key);
  const registry = buildRegistry(state.catalog);
  const result = syncOpenCodeConfig(registry, config);
  restartLaunchAgent();
  console.log(`Cursor catalog refreshed: ${registry.models.length} models, ${variantCount(registry)} variants${result.changed ? " (updated)" : " (unchanged)"}.`);
  console.log("The bridge was restarted. Reload OpenCode if its model picker is already open.");
}

async function models() {
  let state = readCachedCatalog();
  if (!state) {
    const key = loadCursorApiKey();
    if (!key) throw new Error("No cached catalog is available. Run: npm run setup");
    state = await fetchCatalog(key);
  }
  const registry = buildRegistry(state.catalog);
  console.log(`${registry.models.length} models, ${variantCount(registry)} variants (fetched ${state.fetchedAt})`);
  for (const model of registry.models) {
    console.log(`${model.id} — ${model.variants.map((variant) => variant.id).join(", ")}`);
  }
}

function restartLaunchAgent() {
  if (!fs.existsSync(launchAgentPath)) return;
  const domain = `gui/${process.getuid()}`;
  try { execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/ai.dxd.cursor-composer-bridge`]); } catch {}
}

async function uninstall() {
  const domain = `gui/${process.getuid()}`;
  try { execFileSync("/bin/launchctl", ["bootout", domain, launchAgentPath], { stdio: "ignore" }); } catch {}
  if (fs.existsSync(launchAgentPath)) fs.unlinkSync(launchAgentPath);
  const config = readJson(openCodeConfigPath, {});
  if (config.provider?.cursorapi) {
    delete config.provider.cursorapi;
    fs.writeFileSync(openCodeConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  console.log(`Launch agent removed. Credentials remain at ${credentialPath} until you delete them.`);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function help() {
  console.log("Usage: composer-bridge <setup|status|refresh|models|uninstall>");
}

function variantCount(registry) {
  return registry.models.reduce((total, model) => total + model.variants.length, 0);
}
