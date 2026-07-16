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
  openCodeConfigPath,
  projectRoot,
  writePrivateFile
} from "./config.mjs";

const command = process.argv[2] || "help";
if (command === "setup") await setup();
else if (command === "status") await status();
else if (command === "uninstall") await uninstall();
else help();

async function setup() {
  ensurePrivateDirectory();
  const existingDefault = readJson(openCodeConfigPath, {}).model;
  const key = migrateKeychainKey();
  if (!key) throw new Error("Could not read the existing API for Cursor key. Keep that app unlocked and rerun setup, or set CURSOR_API_KEY for this command.");
  writePrivateFile(credentialPath, `CURSOR_API_KEY=${key}\n`);
  writePrivateFile(configPath, `${JSON.stringify(defaults, null, 2)}\n`);
  installOpenCodeProvider();
  installLaunchAgent();
  console.log("Composer Bridge installed and started.");
  const forcedByOldApp = typeof existingDefault === "string" && existingDefault.startsWith("cursorapi/composer-");
  console.log(forcedByOldApp
    ? "Removed the default model forced by API for Cursor."
    : `OpenCode default model preserved: ${existingDefault || "(none configured)"}`);
  console.log("Select cursorapi/composer-2.5 or cursorapi/composer-2.5-fast only when you want it.");
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

function installOpenCodeProvider() {
  const config = readJson(openCodeConfigPath, {});
  if (typeof config.model === "string" && config.model.startsWith("cursorapi/composer-")) {
    delete config.model;
  }
  config.provider ||= {};
  config.provider.cursorapi = {
    name: "Composer Bridge",
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: `http://${defaults.host}:${defaults.port}/v1`, apiKey: defaults.localToken },
    models: Object.fromEntries(defaults.models.map((id) => [id, modelMetadata(id)]))
  };
  fs.mkdirSync(path.dirname(openCodeConfigPath), { recursive: true });
  const backup = `${openCodeConfigPath}.composer-bridge-backup.${Date.now()}`;
  if (fs.existsSync(openCodeConfigPath)) fs.copyFileSync(openCodeConfigPath, backup);
  fs.writeFileSync(openCodeConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

function modelMetadata(id) {
  return {
    name: id.split("-").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ").replace("2.5", "2.5").replace("4.5", "4.5"),
    limit: { context: 200000, output: 65536 }
  };
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
  try {
    const response = await fetch(`http://${defaults.host}:${defaults.port}/health`);
    console.log(JSON.stringify(await response.json(), null, 2));
  } catch {
    console.error("Composer Bridge is not responding.");
    process.exitCode = 1;
  }
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
  console.log("Usage: composer-bridge <setup|status|uninstall>");
}
