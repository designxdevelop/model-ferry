#!/usr/bin/env node
import fs from "node:fs";
import { execFile } from "node:child_process";
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
import { installService, restartService, serviceManager, uninstallService } from "./service.mjs";

const command = process.argv[2] || "help";
if (command === "setup") await setup();
else if (command === "login") await login();
else if (command === "logout") await logout();
else if (command === "status") await status();
else if (command === "refresh") await refresh();
else if (command === "models") await models();
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
    console.log(`Note: the ${serviceManager()} service does not inherit shell environment variables. If the bridge reports not authenticated, run \`npm run login\` once${process.platform === "darwin" ? ", or set CURSOR_API_KEY for launchd with `launchctl setenv CURSOR_API_KEY ...`" : ", or import CURSOR_API_KEY with `systemctl --user import-environment CURSOR_API_KEY` and restart the service"}.`);
  }
  console.log("Your existing OpenCode default model was preserved.");
  console.log("Select the Cursor provider in OpenCode, then choose a model and variant.");
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
  restartBackgroundService();
  console.log(auth.via === "env"
    ? "Authenticated via CURSOR_API_KEY."
    : auth.email ? `Signed in as ${auth.email}.` : "Signed in with your Cursor account.");
  console.log(`Cursor catalog refreshed: ${registry.models.length} models, ${variantCount(registry)} variants.`);
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
  restartBackgroundService();
  console.log(`Cursor catalog refreshed: ${registry.models.length} models, ${variantCount(registry)} variants${result.changed ? " (updated)" : " (unchanged)"}.`);
  console.log("The bridge was restarted. Reload OpenCode if its model picker is already open.");
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

function installBackgroundService() {
  installService({ server: path.join(projectRoot, "src", "server.mjs"), workingDirectory: projectRoot });
}

function restartBackgroundService() {
  restartService();
}

async function uninstall() {
  uninstallService();
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
  console.log("Background service removed. The Cursor browser login (if any) remains in ~/.cursor/sdk/auth.json. Run `modelferry logout` to clear it.");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "/usr/bin/open" : "xdg-open";
  execFile(command, [url], () => {});
}

function help() {
  console.log("Usage: modelferry <setup|login|logout|status|refresh|models|uninstall>");
}

function variantCount(registry) {
  return registry.models.reduce((total, model) => total + model.variants.length, 0);
}
