import test from "node:test";
import assert from "node:assert/strict";
import { serviceDefinition, serviceManager, servicePath } from "../src/service.mjs";

test("macOS keeps the launchd service definition", () => {
  assert.equal(serviceManager("darwin"), "launchd");
  assert.equal(servicePath("darwin", "/Users/austin"), "/Users/austin/Library/LaunchAgents/ai.dxd.modelferry.plist");
  const plist = serviceDefinition({ platform: "darwin", node: "/usr/local/bin/node", server: "/repo/src/server.mjs", workingDirectory: "/repo" });
  assert.match(plist, /<key>Label<\/key><string>ai\.dxd\.modelferry<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
});

test("Linux uses a persistent systemd user service", () => {
  assert.equal(serviceManager("linux"), "systemd");
  assert.equal(servicePath("linux", "/home/austin"), "/home/austin/.config/systemd/user/ai.dxd.modelferry.service");
  const unit = serviceDefinition({ platform: "linux", node: "/usr/bin/node", server: "/repo/src/server.mjs", workingDirectory: "/repo" });
  assert.match(unit, /\[Service\]/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/repo\/src\/server\.mjs/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /WantedBy=default\.target/);
});

test("unsupported platforms produce a clear error", () => {
  assert.throws(() => serviceManager("win32"), /macOS and Linux/);
});
