import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverHarnesses,
  discoverInstalledHarnesses,
  isHarnessInstalled
} from "../src/harnesses.mjs";

test("harness discovery scans both PATH and well-known config homes", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-harness-home-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-harness-bin-"));
  fs.writeFileSync(path.join(bin, "pi"), "");
  fs.mkdirSync(path.join(home, ".claude"));

  const installed = discoverInstalledHarnesses({
    home,
    env: { PATH: bin },
    platform: "linux"
  });

  const pi = installed.find((harness) => harness.id === "pi");
  const claude = installed.find((harness) => harness.id === "claude-code");
  assert.deepEqual(pi.foundBy.commands, ["pi"]);
  assert.equal(pi.setup, "automatic");
  assert.deepEqual(claude.foundBy.configPaths, [path.join(home, ".claude")]);
  assert.equal(claude.setup, "detected-only");
});

test("harness discovery honors agent-specific home overrides", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-harness-overrides-"));
  const codexHome = path.join(home, "custom-codex");
  const hermesHome = path.join(home, "custom-hermes");
  fs.mkdirSync(codexHome);
  fs.mkdirSync(hermesHome);
  const env = { PATH: "", CODEX_HOME: codexHome, HERMES_HOME: hermesHome };

  assert.equal(isHarnessInstalled("codex", { home, env }), true);
  assert.equal(isHarnessInstalled("hermes-agent", { home, env }), true);
});

test("full scan keeps supported but absent harnesses visible", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "modelferry-harness-empty-"));
  const results = discoverHarnesses({ home, env: { PATH: "" }, platform: "linux" });
  assert.equal(results.find((harness) => harness.id === "opencode").installed, false);
  assert.equal(results.find((harness) => harness.id === "hermes-agent").setup, "automatic");
  assert.ok(results.length > 30);
});

test("Windows discovery uses semicolon PATH, PATHEXT, and native config paths", () => {
  const present = new Set([
    "C:\\Tools\\pi.CMD",
    "C:\\Users\\A\\AppData\\Local\\hermes",
    "C:\\Users\\A\\.config\\opencode"
  ]);
  const installed = discoverInstalledHarnesses({
    home: "C:\\Users\\A",
    env: {
      PATH: "C:\\Tools;D:\\Programs",
      PATHEXT: ".EXE;.CMD",
      LOCALAPPDATA: "C:\\Users\\A\\AppData\\Local",
      APPDATA: "C:\\Users\\A\\AppData\\Roaming"
    },
    platform: "win32",
    exists: (candidate) => present.has(candidate)
  });

  assert.deepEqual(installed.find((harness) => harness.id === "pi").foundBy.commands, ["pi"]);
  assert.deepEqual(installed.find((harness) => harness.id === "hermes-agent").foundBy.configPaths, [
    "C:\\Users\\A\\AppData\\Local\\hermes"
  ]);
  assert.deepEqual(installed.find((harness) => harness.id === "opencode").foundBy.configPaths, [
    "C:\\Users\\A\\.config\\opencode"
  ]);
});

test("macOS discovery scans Unix PATH and user config homes", () => {
  const present = new Set([
    "/opt/homebrew/bin/opencode",
    "/Users/a/.pi/agent"
  ]);
  const installed = discoverInstalledHarnesses({
    home: "/Users/a",
    env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin" },
    platform: "darwin",
    exists: (candidate) => present.has(candidate)
  });

  assert.deepEqual(installed.find((harness) => harness.id === "opencode").foundBy.commands, ["opencode"]);
  assert.deepEqual(installed.find((harness) => harness.id === "pi").foundBy.configPaths, ["/Users/a/.pi/agent"]);
});
