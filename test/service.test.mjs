import test from "node:test";
import assert from "node:assert/strict";
import {
  assertUserServiceAvailable,
  serviceDefinition,
  serviceManager,
  servicePath,
  windowsTaskName,
  windowsWrapperPath,
  windowsWrapperScript
} from "../src/service.mjs";

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
  const unit = serviceDefinition({
    platform: "linux",
    node: "/usr/bin/node",
    server: "/repo with %spaces/src/server.mjs",
    workingDirectory: "/repo with %spaces"
  });
  assert.match(unit, /\[Service\]/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/repo\\x20with\\x20%%spaces\/src\/server\.mjs/);
  assert.match(unit, /WorkingDirectory=\/repo\\x20with\\x20%%spaces/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /WantedBy=default\.target/);
});

test("Windows uses a persistent per-user scheduled task with keepalive wrapper", () => {
  assert.equal(serviceManager("win32"), "Windows Task Scheduler");
  assert.equal(servicePath("win32"), windowsTaskName);
  const wrapper = "C:\\Users\\A\\.config\\modelferry\\run-bridge.cmd";
  const task = serviceDefinition({
    platform: "win32",
    node: "C:\\Program Files\\nodejs\\node.exe",
    server: "C:\\Users\\A\\Model Ferry\\src\\server.mjs",
    workingDirectory: "C:\\Users\\A\\Model Ferry",
    wrapper,
    userId: "S-1-5-21-123"
  });
  assert.match(task, /<LogonTrigger><Enabled>true<\/Enabled><UserId>S-1-5-21-123<\/UserId><\/LogonTrigger>/);
  assert.match(task, /<UserId>S-1-5-21-123<\/UserId>/);
  assert.match(task, /<Command>C:\\Users\\A\\.config\\modelferry\\run-bridge\.cmd<\/Command>/);
  assert.match(task, /<WorkingDirectory>C:\\Users\\A\\Model Ferry<\/WorkingDirectory>/);
  assert.match(task, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>3<\/Count><\/RestartOnFailure>/);
  assert.equal(windowsWrapperPath("C:\\Users\\A"), "C:\\Users\\A\\.config\\modelferry\\run-bridge.cmd");
  const script = windowsWrapperScript(
    "C:\\Program Files\\nodejs\\node.exe",
    "C:\\Users\\A\\Model Ferry\\src\\server.mjs"
  );
  assert.match(script, /environment\.cmd/);
  assert.match(script, /"C:\\Program Files\\nodejs\\node\.exe"/);
  assert.match(script, /"C:\\Users\\A\\Model Ferry\\src\\server\.mjs"/);
  assert.match(script, /goto loop/);
});

test("unsupported platforms produce a clear error", () => {
  assert.throws(() => serviceManager("freebsd"), /macOS, Linux, and Windows 10 or later/);
});

test("macOS skips the systemd user-session preflight", () => {
  assert.doesNotThrow(() => assertUserServiceAvailable("darwin"));
});

test("Windows skips the systemd user-session preflight", () => {
  assert.doesNotThrow(() => assertUserServiceAvailable("win32"));
});

test("Linux preflight requires a usable systemd user bus", () => {
  if (process.platform !== "linux") return;
  try {
    assertUserServiceAvailable("linux");
  } catch (error) {
    assert.match(String(error.message), /systemd user session/i);
    return;
  }
  // Bus is available in this environment — preflight succeeded.
  assert.ok(true);
});
