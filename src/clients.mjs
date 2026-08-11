import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseDocument } from "yaml";
import { isHarnessInstalled } from "./harnesses.mjs";

const PROVIDER_ID = "modelferry";

export function piConfigPath(home = os.homedir()) {
  return path.join(home, ".pi", "agent", "models.json");
}

export function hermesConfigPath({
  home = os.homedir(),
  platform = process.platform,
  env = process.env
} = {}) {
  if (env.HERMES_HOME?.trim()) return path.join(env.HERMES_HOME.trim(), "config.yaml");
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local");
    return path.win32.join(localAppData, "hermes", "config.yaml");
  }
  return path.join(home, ".hermes", "config.yaml");
}

export function agentModelEntries(registry) {
  return registry.models.flatMap((model) => {
    const contextWindow = modelContextWindow(model);
    const common = {
      contextWindow,
      maxTokens: 65_536,
      input: ["text"]
    };
    return [
      { id: model.id, name: model.displayName, ...common },
      ...model.variants.map((variant) => ({
        id: `${model.id}@${variant.id}`,
        name: `${model.displayName} · ${variant.displayName}`,
        ...common
      }))
    ];
  });
}

export function syncPiConfig(registry, config, {
  file = piConfigPath(),
  backup = true
} = {}) {
  const current = readJsonStrict(file, {});
  current.providers ||= {};
  const nextProvider = {
    baseUrl: bridgeBaseUrl(config),
    api: "openai-completions",
    apiKey: config.localToken,
    authHeader: true,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false
    },
    models: agentModelEntries(registry).map((model) => ({
      ...model,
      reasoning: false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }))
  };
  if (JSON.stringify(current.providers[PROVIDER_ID]) === JSON.stringify(nextProvider)) {
    return { client: "Pi", changed: false, file };
  }
  current.providers[PROVIDER_ID] = nextProvider;
  const backupPath = writeAtomic(file, `${JSON.stringify(current, null, 2)}\n`, { backup });
  return { client: "Pi", changed: true, file, backupPath };
}

export function syncHermesConfig(registry, config, {
  file = hermesConfigPath(),
  backup = true
} = {}) {
  const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const document = parseDocument(source || "{}\n", { keepSourceTokens: true });
  if (document.errors.length) {
    throw new Error(`Cannot update Hermes config because ${file} is not valid YAML: ${document.errors[0].message}`);
  }
  const models = Object.fromEntries(agentModelEntries(registry).map((model) => [model.id, {
    name: model.name,
    context_length: model.contextWindow,
    max_tokens: model.maxTokens
  }]));
  const nextProvider = {
    name: "Model Ferry",
    api: bridgeBaseUrl(config),
    api_key: config.localToken,
    transport: "chat_completions",
    discover_models: false,
    models
  };
  const previous = document.getIn(["providers", PROVIDER_ID], true)?.toJSON?.()
    ?? document.getIn(["providers", PROVIDER_ID]);
  if (JSON.stringify(previous) === JSON.stringify(nextProvider)) {
    return { client: "Hermes", changed: false, file };
  }
  document.setIn(["providers", PROVIDER_ID], nextProvider);
  const backupPath = writeAtomic(file, document.toString(), { backup });
  return { client: "Hermes", changed: true, file, backupPath };
}

export function syncInstalledAgentConfigs(registry, config, options = {}) {
  const results = [];
  const piFile = options.piFile || piConfigPath(options.home);
  const hermesFile = options.hermesFile || hermesConfigPath(options);
  if (options.piInstalled ?? isHarnessInstalled("pi", options)) {
    results.push(safeSync("Pi", piFile, () => syncPiConfig(registry, config, { file: piFile, backup: options.backup })));
  }
  if (options.hermesInstalled ?? isHarnessInstalled("hermes-agent", options)) {
    results.push(safeSync("Hermes", hermesFile, () => syncHermesConfig(registry, config, { file: hermesFile, backup: options.backup })));
  }
  return results;
}

function safeSync(client, file, operation) {
  try {
    return operation();
  } catch (error) {
    return { client, changed: false, file, error: error.message };
  }
}

export function removeAgentConfigs(options = {}) {
  const results = [];
  const piFile = options.piFile || piConfigPath(options.home);
  const hermesFile = options.hermesFile || hermesConfigPath(options);
  if (fs.existsSync(piFile)) {
    try {
      const current = readJsonStrict(piFile, {});
      if (current.providers?.[PROVIDER_ID]) {
        delete current.providers[PROVIDER_ID];
        writeAtomic(piFile, `${JSON.stringify(current, null, 2)}\n`, { backup: false });
        results.push({ client: "Pi", changed: true, file: piFile });
      }
    } catch {
      // Leave malformed Pi config alone so uninstall can still clean Hermes/OpenCode.
    }
  }
  if (fs.existsSync(hermesFile)) {
    const document = parseDocument(fs.readFileSync(hermesFile, "utf8"), { keepSourceTokens: true });
    if (!document.errors.length && document.hasIn(["providers", PROVIDER_ID])) {
      document.deleteIn(["providers", PROVIDER_ID]);
      writeAtomic(hermesFile, document.toString(), { backup: false });
      results.push({ client: "Hermes", changed: true, file: hermesFile });
    }
  }
  return results;
}

function bridgeBaseUrl(config) {
  return `http://${config.host}:${config.port}/v1`;
}

function modelContextWindow(model) {
  const contexts = model.parameters
    .find((parameter) => parameter.id === "context")
    ?.values.map((item) => parseContext(item.value)).filter(Boolean) || [];
  return contexts.length ? Math.max(...contexts) : 200_000;
}

function parseContext(value) {
  const match = String(value).toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1));
}

function readJsonStrict(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeAtomic(file, content, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let backupPath;
  if (backup && fs.existsSync(file)) {
    backupPath = `${file}.modelferry-backup.${Date.now()}`;
    fs.copyFileSync(file, backupPath);
  }
  const temporary = `${file}.modelferry-${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch {}
  return backupPath;
}
