import test from "node:test";
import assert from "node:assert/strict";
import { serviceDefinition, serviceManager, servicePath, windowsTaskName } from "../src/service.mjs";

test("macOS keeps the launchd service definition", () => {
  assert.equal(serviceManager("darwin"), "launchd");
  assert.equal(servicePath("darwin", "/Users/austin"), "/Users/austin/Library/LaunchAgents/ai.dxd.modelferry.plist");
  const plist = serviceDefinition({ platform: "darwin", node: "/usr/local/bin/node", server: "/repo/src/server.mjs", workingDirectory: "/repo" });
  assert.match(plist, /<key>Label<\/key><string>ai\.dxd\.modelferry<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
});

test("Windows uses a persistent per-user scheduled task", () => {
  assert.equal(serviceManager("win32"), "Windows Task Scheduler");
  assert.equal(servicePath("win32"), windowsTaskName);
  const task = serviceDefinition({ platform: "win32", node: "C:\\Program Files\\nodejs\\node.exe", server: "C:\\Users\\A\\Model Ferry\\src\\server.mjs", workingDirectory: "C:\\Users\\A\\Model Ferry", userId: "S-1-5-21-123" });
  assert.match(task, /<LogonTrigger><Enabled>true<\/Enabled><\/LogonTrigger>/);
  assert.match(task, /<UserId>S-1-5-21-123<\/UserId>/);
  assert.match(task, /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>/);
  assert.match(task, /<WorkingDirectory>C:\\Users\\A\\Model Ferry<\/WorkingDirectory>/);
  assert.match(task, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>3<\/Count><\/RestartOnFailure>/);
});

test("unsupported platforms produce a clear error", () => {
  assert.throws(() => serviceManager("linux"), /macOS and Windows 10 or later/);
});
