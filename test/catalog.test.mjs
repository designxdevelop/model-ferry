import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRegistry, normalizeCatalog, providerModels, resolveSelection, syncOpenCodeConfig } from "../src/catalog.mjs";

const rawCatalog = [{
  id: "gpt-test",
  displayName: "GPT Test",
  aliases: ["gpt-latest"],
  parameters: [
    { id: "reasoning", values: [{ value: "low" }, { value: "high" }] },
    { id: "fast", values: [{ value: "false" }, { value: "true" }] }
  ],
  variants: [
    { params: [{ id: "reasoning", value: "low" }, { id: "fast", value: "false" }], displayName: "GPT Test" },
    { params: [{ id: "reasoning", value: "high" }, { id: "fast", value: "true" }], displayName: "GPT Test", isDefault: true }
  ]
}, {
  id: "plain-model",
  displayName: "Plain Model",
  variants: [{ params: [], displayName: "Plain Model", isDefault: true }]
}];

test("builds exact default, native variant, alias, and compatibility selections", () => {
  const registry = buildRegistry(normalizeCatalog(rawCatalog));
  assert.deepEqual(resolveSelection(registry, "cursorapi/gpt-test"), {
    id: "gpt-test",
    params: [{ id: "reasoning", value: "high" }, { id: "fast", value: "true" }]
  });
  assert.deepEqual(resolveSelection(registry, "gpt-latest"), resolveSelection(registry, "gpt-test"));
  assert.deepEqual(resolveSelection(registry, "gpt-test@low-standard"), {
    id: "gpt-test",
    params: [{ id: "reasoning", value: "low" }, { id: "fast", value: "false" }]
  });
  assert.deepEqual(resolveSelection(registry, "plain-model"), { id: "plain-model" });
});

test("accepts only Cursor-advertised native variant parameter combinations", () => {
  const registry = buildRegistry(normalizeCatalog(rawCatalog));
  assert.deepEqual(resolveSelection(registry, "gpt-test", {
    cursor_params: [{ id: "fast", value: "true" }, { id: "reasoning", value: "high" }]
  }), {
    id: "gpt-test",
    params: [{ id: "fast", value: "true" }, { id: "reasoning", value: "high" }]
  });
  assert.equal(resolveSelection(registry, "gpt-test", {
    cursor_params: [{ id: "reasoning", value: "low" }, { id: "fast", value: "true" }]
  }), null);
  assert.equal(resolveSelection(registry, "gpt-test", { cursor_params: "invalid" }), null);
});

test("generates OpenCode native variants and optional flattened aliases", () => {
  const registry = buildRegistry(normalizeCatalog(rawCatalog));
  const compact = providerModels(registry);
  assert.deepEqual(compact["gpt-test"].variants["high-fast"].cursor_params, [
    { id: "reasoning", value: "high" }, { id: "fast", value: "true" }
  ]);
  assert.equal(compact["gpt-test@high-fast"], undefined);
  assert.equal(compact["plain-model"].variants, undefined);
  const expanded = providerModels(registry, { exposeVariantAliases: true });
  assert.equal(expanded["gpt-test@high-fast"].id, "gpt-test");
  assert.deepEqual(expanded["gpt-test@high-fast"].options.cursor_params, compact["gpt-test"].variants["high-fast"].cursor_params);
});

test("rejects empty catalogs and skips duplicate model IDs", () => {
  assert.throws(() => normalizeCatalog([]), /empty model catalog/);
  assert.equal(normalizeCatalog([...rawCatalog, rawCatalog[0]]).length, 2);
});

test("synchronizes only the bridge-owned provider and avoids unchanged rewrites", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-test-"));
  const file = path.join(directory, "opencode.json");
  fs.writeFileSync(file, JSON.stringify({ model: "other/default", plugin: ["keep-me"], provider: { other: { name: "Other" } } }));
  const registry = buildRegistry(normalizeCatalog(rawCatalog));
  const config = { host: "127.0.0.1", port: 8791, localToken: "local", exposeVariantAliases: false };
  const first = syncOpenCodeConfig(registry, config, { backup: false, file });
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(first.changed, true);
  assert.equal(saved.model, "other/default");
  assert.deepEqual(saved.plugin, ["keep-me"]);
  assert.equal(saved.provider.other.name, "Other");
  assert.ok(saved.provider.cursorapi.models["gpt-test"].variants["high-fast"]);
  const before = fs.statSync(file).mtimeMs;
  const second = syncOpenCodeConfig(registry, config, { backup: false, file });
  assert.equal(second.changed, false);
  assert.equal(fs.statSync(file).mtimeMs, before);
});
