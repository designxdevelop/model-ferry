#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { authStatus, login as browserLogin, logout as clearAuth } from "./auth.mjs";
import {
  ensureConfig,
  loadConfig,
  openCodeConfigPath,
  projectRoot
} from "./config.mjs";
import { buildRegistry, fetchCatalog, readCachedCatalog, syncOpenCodeConfig } from "./catalog.mjs";
import { removeAgentConfigs, syncInstalledAgentConfigs } from "./clients.mjs";
import { discoverHarnesses, discoverInstalledHarnesses } from "./harnesses.mjs";
import { installService, restartService, serviceManager, uninstallService } from "./service.mjs";

const command = process.argv[2] || "help";
if (command === "setup") await setup();
else if (command === "login") await login();
else if (command === "logout") await logout();
else if (command === "status") await status();
else if (command === "refresh") await refresh();
else if (command === "models") await models();
else if (command === "agents" || command === "clients" || command === "harnesses") await agents();
else if (command === "uninstall") await uninstall();
else help();

async function setup() {
  const config = ensureConfig();
  const wasAuthenticated = (await authStatus()).status === "logged-in";
  installBackgroundService();
  let auth = await authStatus();
  if (auth.status !== "logged-in") {
    console.log("Opening the Model Ferry setup page in your browser…");
    console.log(`If it does not open, visit ${onboardUrl()}`);
    openBrowser(onboardUrl());
    await waitForLogin();
    auth = await authStatus();
  }
  const state = await fetchCatalog();
  const registry = buildRegistry(state.catalog);
  syncOpenCodeConfig(registry, config);
  const agents = syncInstalledAgentConfigs(registry, config);
  restartBackgroundService();
  console.log(`Model Ferry installed with ${registry.models.length} Cursor models and ${variantCount(registry)} variants.`);
  if (!wasAuthenticated) {
    console.log(auth.via === "env"
      ? "Authenticated via CURSOR_API_KEY."
      : auth.email ? `Signed in as ${auth.email}.` : "Signed in with your Cursor account.");
  } else if (auth.via === "env") {
    console.log("Authenticated via CURSOR_API_KEY.");
  }
  if (auth.via === "env") {
    console.log(`Note: the ${serviceManager()} service does not inherit shell environment variables. If the bridge reports not authenticated, run \`npm run login\` once${cursorApiKeyServiceHint()}.`);
  }
  console.log("Your existing agent default models were preserved.");
  console.log("Configured Cursor provider for OpenCode.");
  reportAgentConfigs(agents, "Configured Model Ferry for", { includeUnchanged: true });
  reportDetectedHarnesses();
  console.log("Select Cursor in OpenCode or Model Ferry in Pi/Hermes, then choose a model and variant.");
  console.log("Run `modelferry agents` any time to rescan installed agent harnesses.");
}

async function login() {
  ensureConfig();
  const already = await authStatus();
  if (already.status === "logged-in") {
    await browserLogin();
  } else if (await serverReachable()) {
    console.log("Opening the Model Ferry setup page in your browser…");
    console.log(`If it does not open, visit ${onboardUrl()}`);
    openBrowser(onboardUrl());
    await waitForLogin();
  } else {
    await browserLogin();
  }
  const auth = await authStatus();
  const config = loadConfig();
  const state = await fetchCatalog();
  const registry = buildRegistry(state.catalog);
  syncOpenCodeConfig(registry, config);
  const agents = syncInstalledAgentConfigs(registry, config);
  restartBackgroundService();
  console.log(auth.via === "env"
    ? "Authenticated via CURSOR_API_KEY."
    : auth.email ? `Signed in as ${auth.email}.` : "Signed in with your Cursor account.");
  console.log(`Cursor catalog refreshed: ${registry.models.length} models, ${variantCount(registry)} variants.`);
  reportAgentConfigs(agents);
}

async function waitForLogin() {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await authStatus();
    if (status.status === "logged-in") {
      console.log(status.email ? `Signed in as ${status.email}.` : "Signed in with your Cursor account.");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Sign-in did not complete. Re-run \`npm run setup\` or visit ${onboardUrl()} to sign in.`);
}

async function serverReachable() {
  try {
    const config = loadConfig();
    const response = await fetch(`http://${config.host}:${config.port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function onboardUrl() {
  const config = loadConfig();
  return `http://${config.host}:${config.port}/onboard`;
}

async function logout() {
  await clearAuth();
  console.log("Signed out. The minted API key stays valid in the Cursor dashboard until it expires.");
}

async function status() {
  const auth = await authStatus();
  const expiry = auth.apiKeyExpiresAtMs ? ` (expires ${new Date(auth.apiKeyExpiresAtMs).toLocaleDateString()})` : "";
  console.log(`auth: ${auth.status === "logged-in"
    ? `logged in${auth.via === "env" ? " (CURSOR_API_KEY)" : auth.email ? ` (${auth.email})` : ""}${expiry}`
    : "logged out"}`);
  const config = loadConfig();
  console.log(`endpoint: http://${config.host}:${config.port}/v1`);
  try {
    const response = await fetch(`http://${config.host}:${config.port}/health`);
    console.log(JSON.stringify(await response.json(), null, 2));
  } catch {
    console.error("Model Ferry is not responding.");
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
  const state = await fetchCatalog();
  const registry = buildRegistry(state.catalog);
  const result = syncOpenCodeConfig(registry, config);
  const agents = syncInstalledAgentConfigs(registry, config);
  restartBackgroundService();
  console.log(`Cursor catalog refreshed: ${registry.models.length} models, ${variantCount(registry)} variants${result.changed ? " (updated)" : " (unchanged)"}.`);
  reportAgentConfigs(agents);
  console.log("The bridge was restarted. Reload your client's model picker if it is already open.");
}

async function models() {
  let state = readCachedCatalog();
  if (!state) {
    state = await fetchCatalog();
  }
  const registry = buildRegistry(state.catalog);
  console.log(`${registry.models.length} models, ${variantCount(registry)} variants (fetched ${state.fetchedAt})`);
  for (const model of registry.models) {
    console.log(`${model.id} — ${model.variants.map((variant) => variant.id).join(", ")}`);
  }
}

async function agents() {
  const installed = discoverInstalledHarnesses();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(installed, null, 2));
    return;
  }
  if (!installed.length) {
    console.log("No recognized local agent harnesses were found.");
    return;
  }
  console.log(`Detected ${installed.length} local agent harness${installed.length === 1 ? "" : "es"}:`);
  printHarnesses(installed);
  const available = discoverHarnesses().filter((harness) => !harness.installed && harness.setup === "automatic");
  if (available.length) {
    console.log(`Automatic setup is also available when installed: ${available.map((harness) => harness.displayName).join(", ")}.`);
  }
  console.log("Detected-only means Model Ferry found the harness but does not edit its provider config yet.");
}

function serverPath() {
  return path.join(projectRoot, "src", "server.mjs");
}

function installBackgroundService() {
  installService({ server: serverPath(), workingDirectory: projectRoot });
}

function restartBackgroundService() {
  restartService(process.platform, { server: serverPath() });
}

async function uninstall() {
  uninstallService(process.platform, { server: serverPath() });
  const agents = removeAgentConfigs();
  const config = readJson(openCodeConfigPath, {});
  let changed = false;
  if (config.provider?.cursorapi) {
    delete config.provider.cursorapi;
    changed = true;
  }
  if (config.providers?.cursorapi) {
    delete config.providers.cursorapi;
    changed = true;
  }
  if (changed) fs.writeFileSync(openCodeConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  reportAgentConfigs(agents, "Removed Model Ferry from");
  console.log("Background service removed. The Cursor browser login (if any) remains in ~/.cursor/sdk/auth.json. Run `modelferry logout` to clear it.");
}

function reportAgentConfigs(results, prefix = "Added Model Ferry to", { includeUnchanged = false } = {}) {
  for (const result of results) {
    if (result.changed || (includeUnchanged && !result.error)) console.log(`${prefix} ${result.client}.`);
    else if (result.error) console.warn(`Could not update ${result.client}: ${result.error}`);
  }
}

function reportDetectedHarnesses() {
  const detectedOnly = discoverInstalledHarnesses().filter((harness) => harness.setup === "detected-only");
  if (!detectedOnly.length) return;
  console.log(`Also detected ${detectedOnly.length} harness${detectedOnly.length === 1 ? "" : "es"} without an automatic provider adapter:`);
  printHarnesses(detectedOnly);
}

function printHarnesses(harnesses) {
  const width = Math.max(...harnesses.map((harness) => harness.displayName.length));
  for (const harness of harnesses) {
    const status = harness.setup === "automatic" ? "automatic setup" : "detected only";
    const evidence = [
      ...harness.foundBy.commands.map((command) => `${command} on PATH`),
      ...harness.foundBy.configPaths
    ].join(", ");
    console.log(`  ${harness.displayName.padEnd(width)}  ${status}${evidence ? `  (${evidence})` : ""}`);
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function cursorApiKeyServiceHint() {
  if (process.platform === "darwin") {
    return ", or set CURSOR_API_KEY for launchd with `launchctl setenv CURSOR_API_KEY ...`";
  }
  if (process.platform === "linux") {
    return ", or put CURSOR_API_KEY in ~/.config/environment.d/modelferry.conf and restart the service";
  }
  if (process.platform === "win32") {
    return ", or put `set CURSOR_API_KEY=...` in %USERPROFILE%\\.config\\modelferry\\environment.cmd and restart the Model Ferry task";
  }
  return "";
}

function openBrowser(url) {
  if (process.platform === "darwin") execFile("/usr/bin/open", [url], () => {});
  else if (process.platform === "win32") execFile("cmd.exe", ["/d", "/s", "/c", `start "" "${url}"`], () => {});
  else execFile("xdg-open", [url], () => {});
}

function help() {
  console.log("Usage: modelferry <setup|login|logout|status|refresh|models|agents|uninstall>");
}

function variantCount(registry) {
  return registry.models.reduce((total, model) => total + model.variants.length, 0);
}
