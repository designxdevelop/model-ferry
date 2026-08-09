import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const serviceLabel = "ai.dxd.modelferry";
export const windowsTaskName = "\\Model Ferry";

export function windowsWrapperPath(home = os.homedir()) {
  return path.win32.join(home, ".config", "modelferry", "run-bridge.cmd");
}

export function windowsEnvPath(home = os.homedir()) {
  return path.win32.join(home, ".config", "modelferry", "environment.cmd");
}

export function serviceManager(platform = process.platform) {
  if (platform === "darwin") return "launchd";
  if (platform === "linux") return "systemd";
  if (platform === "win32") return "Windows Task Scheduler";
  throw new Error(`Model Ferry supports macOS, Linux, and Windows 10 or later; ${platform} is not supported.`);
}

export function servicePath(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") return path.join(home, "Library", "LaunchAgents", `${serviceLabel}.plist`);
  if (platform === "linux") return path.join(home, ".config", "systemd", "user", `${serviceLabel}.service`);
  if (platform === "win32") return windowsTaskName;
  throw new Error(`Model Ferry supports macOS, Linux, and Windows 10 or later; ${platform} is not supported.`);
}

export function serviceDefinition({
  platform = process.platform,
  node = process.execPath,
  server,
  workingDirectory,
  userId,
  wrapper
}) {
  if (platform === "darwin") return launchdPlist(node, server, workingDirectory);
  if (platform === "linux") return systemdUnit(node, server, workingDirectory);
  if (platform === "win32") return windowsTaskXml(wrapper || windowsWrapperPath(), workingDirectory, userId);
  throw new Error(`Model Ferry supports macOS, Linux, and Windows 10 or later; ${platform} is not supported.`);
}

export function assertUserServiceAvailable(platform = process.platform) {
  if (platform !== "linux") return;
  // is-system-running exits non-zero for degraded/offline; any reply from the
  // user bus (including show-environment) means we can manage user units.
  if (userSystemctlWorks(["is-system-running"]) || userSystemctlWorks(["show-environment"])) return;
  throw new Error(
    "A systemd user session is required (systemctl --user is unavailable). " +
    "Log into a graphical or pam_systemd session, or enable lingering with " +
    "`loginctl enable-linger $USER`, then re-run setup."
  );
}

function userSystemctlWorks(args) {
  try {
    execFileSync("systemctl", ["--user", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000
    });
    return true;
  } catch (error) {
    const detail = `${error.stderr || ""}`.toLowerCase();
    if (error.code === "ENOENT") return false;
    if (detail.includes("failed to connect") || detail.includes("no medium found")) return false;
    // Bus answered with a non-zero unit state (degraded/offline/etc.).
    return typeof error.status === "number";
  }
}

export function installService({
  platform = process.platform,
  node = process.execPath,
  server,
  workingDirectory
}) {
  assertUserServiceAvailable(platform);

  if (platform === "darwin" || platform === "linux") {
    const target = servicePath(platform);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serviceDefinition({ platform, node, server, workingDirectory }));

    if (platform === "darwin") {
      const domain = `gui/${process.getuid()}`;
      try { execFileSync("/bin/launchctl", ["bootout", domain, target], { stdio: "ignore" }); } catch {}
      execFileSync("/bin/launchctl", ["bootstrap", domain, target]);
      execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`]);
      return;
    }

    execFileSync("systemctl", ["--user", "daemon-reload"]);
    execFileSync("systemctl", ["--user", "enable", "--now", `${serviceLabel}.service`]);
    return;
  }

  if (platform === "win32") {
    const wrapper = windowsWrapperPath();
    fs.mkdirSync(path.win32.dirname(wrapper), { recursive: true });
    writeWindowsEnvironmentFile();
    fs.writeFileSync(wrapper, windowsWrapperScript(node, server), "utf8");
    const taskFile = path.join(os.tmpdir(), `${serviceLabel}-${process.pid}.xml`);
    try {
      const definition = serviceDefinition({
        platform,
        node,
        server,
        workingDirectory,
        wrapper,
        userId: windowsUserId()
      });
      fs.writeFileSync(taskFile, `\uFEFF${definition}`, "utf16le");
      execFileSync("schtasks.exe", ["/Create", "/TN", windowsTaskName, "/XML", taskFile, "/F"]);
      stopWindowsBridge({ server, wrapper });
      execFileSync("schtasks.exe", ["/Run", "/TN", windowsTaskName]);
    } finally {
      try { fs.unlinkSync(taskFile); } catch {}
    }
    return;
  }

  throw new Error(`Model Ferry supports macOS, Linux, and Windows 10 or later; ${platform} is not supported.`);
}

export function restartService(platform = process.platform, {
  server = null,
  wrapper = windowsWrapperPath()
} = {}) {
  if (platform === "darwin") {
    const target = servicePath(platform);
    if (!fs.existsSync(target)) return;
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`]); } catch {}
    return;
  }
  if (platform === "linux") {
    const target = servicePath(platform);
    if (!fs.existsSync(target)) return;
    try { execFileSync("systemctl", ["--user", "restart", `${serviceLabel}.service`]); } catch {}
    return;
  }
  if (platform === "win32") {
    stopWindowsBridge({ server, wrapper });
    try { execFileSync("schtasks.exe", ["/Run", "/TN", windowsTaskName]); } catch {}
    return;
  }
  throw new Error(`Model Ferry supports macOS, Linux, and Windows 10 or later; ${platform} is not supported.`);
}

export function uninstallService(platform = process.platform, {
  server = null,
  wrapper = windowsWrapperPath()
} = {}) {
  if (platform === "darwin") {
    const target = servicePath(platform);
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["bootout", domain, target], { stdio: "ignore" }); } catch {}
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return;
  }
  if (platform === "linux") {
    const target = servicePath(platform);
    try { execFileSync("systemctl", ["--user", "disable", "--now", `${serviceLabel}.service`], { stdio: "ignore" }); } catch {}
    if (fs.existsSync(target)) fs.unlinkSync(target);
    try { execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" }); } catch {}
    return;
  }
  if (platform === "win32") {
    stopWindowsBridge({ server, wrapper });
    try { execFileSync("schtasks.exe", ["/Delete", "/TN", windowsTaskName, "/F"], { stdio: "ignore" }); } catch {}
    if (fs.existsSync(wrapper)) fs.unlinkSync(wrapper);
    return;
  }
  throw new Error(`Model Ferry supports macOS, Linux, and Windows 10 or later; ${platform} is not supported.`);
}

export function windowsWrapperScript(node, server) {
  const envFile = windowsEnvPath();
  return `@echo off\r
setlocal\r
if exist "${batchPath(envFile)}" call "${batchPath(envFile)}"\r
:loop\r
"${batchPath(node)}" "${batchPath(server)}"\r
timeout /t 5 /nobreak >nul\r
goto loop\r
`;
}

function writeWindowsEnvironmentFile() {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) return;
  const target = windowsEnvPath();
  fs.mkdirSync(path.win32.dirname(target), { recursive: true });
  // Quote the assignment so spaces/specials in keys don't break cmd parsing.
  fs.writeFileSync(target, `@echo off\r\nset "CURSOR_API_KEY=${key.replaceAll('"', "")}"\r\n`, "utf8");
}

function stopWindowsBridge({ server, wrapper }) {
  try { execFileSync("schtasks.exe", ["/End", "/TN", windowsTaskName], { stdio: "ignore" }); } catch {}
  killWindowsBridgeProcesses({ server, wrapper });
  waitUntilWindowsBridgeStopped({ server, wrapper }, 10_000);
}

function killWindowsBridgeProcesses({ server, wrapper }) {
  const patterns = [server, wrapper].filter(Boolean);
  if (patterns.length === 0) return;
  const psPatterns = patterns.map(windowsPowerShellSingleQuote).join(", ");
  // Prefer taskkill /T so ending the wrapper cmd also reaps the node child.
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$patterns = @(${psPatterns})`,
    "Get-CimInstance Win32_Process | Where-Object {",
    "  if (-not $_.CommandLine) { return $false }",
    "  if ($_.Name -notin @('node.exe', 'cmd.exe')) { return $false }",
    "  foreach ($pattern in $patterns) {",
    "    if ($_.CommandLine -like ('*' + $pattern + '*')) { return $true }",
    "  }",
    "  return $false",
    "} | ForEach-Object { & taskkill.exe /F /T /PID $_.ProcessId | Out-Null }"
  ].join("; ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "ignore",
      timeout: 15_000
    });
  } catch {}
}

function waitUntilWindowsBridgeStopped({ server, wrapper }, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!windowsBridgeProcessesRunning({ server, wrapper })) return;
    sleepSync(200);
  }
}

function windowsBridgeProcessesRunning({ server, wrapper }) {
  const patterns = [server, wrapper].filter(Boolean);
  if (patterns.length === 0) return false;
  const psPatterns = patterns.map(windowsPowerShellSingleQuote).join(", ");
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$patterns = @(${psPatterns})`,
    "$match = Get-CimInstance Win32_Process | Where-Object {",
    "  if (-not $_.CommandLine) { return $false }",
    "  if ($_.Name -notin @('node.exe', 'cmd.exe')) { return $false }",
    "  foreach ($pattern in $patterns) {",
    "    if ($_.CommandLine -like ('*' + $pattern + '*')) { return $true }",
    "  }",
    "  return $false",
    "} | Select-Object -First 1",
    "if ($match) { exit 0 } else { exit 1 }"
  ].join("; ");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: "ignore",
      timeout: 15_000
    });
    return true;
  } catch (error) {
    return error.status === 0;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function launchdPlist(node, server, workingDirectory) {
  const logDir = path.join(os.homedir(), "Library", "Logs", "ModelFerry");
  fs.mkdirSync(logDir, { recursive: true });
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${serviceLabel}</string>
  <key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(server)}</string></array>
  <key>WorkingDirectory</key><string>${xml(workingDirectory)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(path.join(logDir, "stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logDir, "stderr.log"))}</string>
</dict></plist>\n`;
}

function systemdUnit(node, server, workingDirectory) {
  return `[Unit]
Description=Model Ferry Cursor API bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(workingDirectory)}
ExecStart=${systemdEscape(node)} ${systemdEscape(server)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function windowsTaskXml(wrapper, workingDirectory, userId = "CURRENT_USER") {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><URI>${xml(windowsTaskName)}</URI></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xml(userId)}</UserId></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>${xml(userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xml(wrapper)}</Command><WorkingDirectory>${xml(workingDirectory)}</WorkingDirectory></Exec></Actions>
</Task>\n`;
}

function windowsUserId() {
  const output = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  const match = output.match(/"(S-1-[0-9-]+)"\s*$/m);
  if (!match) throw new Error("Could not determine the current Windows user SID for the Model Ferry task.");
  return match[1];
}

function batchPath(value) {
  return String(value).replaceAll('"', "");
}

function windowsPowerShellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function systemdEscape(value) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "%%")
    .replaceAll('"', '\\"')
    .replaceAll("$", "$$")
    .replaceAll(" ", "\\x20");
}
