import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { buildRegistry, normalizeCatalog } from "../src/catalog.mjs";
import {
  agentModelEntries,
  hermesConfigPath,
  removeAgentConfigs,
  syncHermesConfig,
  syncInstalledAgentConfigs,
  syncPiConfig
} from "../src/clients.mjs";

const registry = buildRegistry(normalizeCatalog([{
  id: "gpt-test",
  displayName: "GPT Test",
  parameters: [{ id: "context", values: [{ value: "200k" }, { value: "1m" }] }],
  variants: [
    { params: [{ id: "reasoning", value: "low" }], displayName: "Low" },
    { params: [{ id: "reasoning", value: "high" }], displayName: "High", isDefault: true }
  ]
}]));
const config = { host: "127.0.0.1", port: 8791, localToken: "local-token" };

test("agent clients receive base models and deterministic variant aliases", () => {
  const entries = agentModelEntries(registry);
  assert.deepEqual(entries.map((entry) => entry.id), [
    "gpt-test",
    "gpt-test@low",
    "gpt-test@high"
  ]);
  assert.equal(entries[0].contextWindow, 1_000_000);
  assert.equal(entries[2].name, "GPT Test · High");
});

test("Pi sync preserves other providers and is idempotent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-pi-"));
  const file = path.join(directory, "models.json");
  fs.writeFileSync(file, JSON.stringify({ providers: { other: { models: [] } } }));
  assert.equal(syncPiConfig(registry, config, { file, backup: false }).changed, true);
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(saved.providers.other);
  assert.equal(saved.providers.modelferry.baseUrl, "http://127.0.0.1:8791/v1");
  assert.equal(saved.providers.modelferry.apiKey, "local-token");
  assert.ok(saved.providers.modelferry.models.some((model) => model.id === "gpt-test@high"));
  assert.equal(syncPiConfig(registry, config, { file, backup: false }).changed, false);
});

test("Hermes sync preserves user settings and comments", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-hermes-"));
  const file = path.join(directory, "config.yaml");
  fs.writeFileSync(file, "# keep this comment\nmodel:\n  provider: other\n  default: other-model\nproviders:\n  other:\n    api: https://example.com/v1\n");
  assert.equal(syncHermesConfig(registry, config, { file, backup: false }).changed, true);
  const source = fs.readFileSync(file, "utf8");
  const saved = parse(source);
  assert.match(source, /keep this comment/);
  assert.equal(saved.model.provider, "other");
  assert.equal(saved.providers.other.api, "https://example.com/v1");
  assert.equal(saved.providers.modelferry.api, "http://127.0.0.1:8791/v1");
  assert.equal(saved.providers.modelferry.discover_models, false);
  assert.equal(saved.providers.modelferry.models["gpt-test@low"].context_length, 1_000_000);
  assert.equal(syncHermesConfig(registry, config, { file, backup: false }).changed, false);
});

test("installed-client sync isolates malformed client configs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-agents-"));
  const piFile = path.join(directory, "pi.json");
  const hermesFile = path.join(directory, "hermes.yaml");
  fs.writeFileSync(hermesFile, "providers: [\n");
  const results = syncInstalledAgentConfigs(registry, config, {
    piInstalled: true,
    hermesInstalled: true,
    piFile,
    hermesFile,
    backup: false
  });
  assert.equal(results.find((result) => result.client === "Pi").changed, true);
  assert.match(results.find((result) => result.client === "Hermes").error, /not valid YAML/);
});

test("agent config removal deletes only Model Ferry providers", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-remove-"));
  const piFile = path.join(directory, "pi.json");
  const hermesFile = path.join(directory, "hermes.yaml");
  syncPiConfig(registry, config, { file: piFile, backup: false });
  fs.writeFileSync(hermesFile, "providers:\n  other:\n    api: https://example.com/v1\n");
  syncHermesConfig(registry, config, { file: hermesFile, backup: false });
  const results = removeAgentConfigs({ piFile, hermesFile });
  assert.equal(results.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(piFile, "utf8")).providers.modelferry, undefined);
  const hermes = parse(fs.readFileSync(hermesFile, "utf8"));
  assert.ok(hermes.providers.other);
  assert.equal(hermes.providers.modelferry, undefined);
});

test("Hermes uses its native Windows config directory", () => {
  assert.equal(
    hermesConfigPath({ home: "C:\\Users\\A", platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local" } }),
    "C:\\Users\\A\\AppData\\Local\\hermes\\config.yaml"
  );
});
