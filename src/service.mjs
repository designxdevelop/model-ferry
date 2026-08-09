import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const serviceLabel = "ai.dxd.modelferry";
export const windowsTaskName = "\\Model Ferry";

export function serviceManager(platform = process.platform) {
  if (platform === "darwin") return "launchd";
  if (platform === "win32") return "Windows Task Scheduler";
  throw new Error(`Model Ferry supports macOS and Windows 10 or later; ${platform} is not supported.`);
}

export function servicePath(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") return path.join(home, "Library", "LaunchAgents", `${serviceLabel}.plist`);
  if (platform === "win32") return windowsTaskName;
  throw new Error(`Model Ferry supports macOS and Windows 10 or later; ${platform} is not supported.`);
}

export function serviceDefinition({
  platform = process.platform,
  node = process.execPath,
  server,
  workingDirectory,
  userId
}) {
  if (platform === "darwin") return launchdPlist(node, server, workingDirectory);
  if (platform === "win32") return windowsTaskXml(node, server, workingDirectory, userId);
  throw new Error(`Model Ferry supports macOS and Windows 10 or later; ${platform} is not supported.`);
}

export function installService({
  platform = process.platform,
  node = process.execPath,
  server,
  workingDirectory
}) {
  if (platform === "darwin") {
    const target = servicePath(platform);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serviceDefinition({ platform, node, server, workingDirectory }));
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["bootout", domain, target], { stdio: "ignore" }); } catch {}
    execFileSync("/bin/launchctl", ["bootstrap", domain, target]);
    execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`]);
    return;
  }
  if (platform === "win32") {
    const taskFile = path.join(os.tmpdir(), `${serviceLabel}-${process.pid}.xml`);
    try {
      const definition = serviceDefinition({ platform, node, server, workingDirectory, userId: windowsUserId() });
      fs.writeFileSync(taskFile, `\uFEFF${definition}`, "utf16le");
      execFileSync("schtasks.exe", ["/Create", "/TN", windowsTaskName, "/XML", taskFile, "/F"]);
      execFileSync("schtasks.exe", ["/Run", "/TN", windowsTaskName]);
    } finally {
      try { fs.unlinkSync(taskFile); } catch {}
    }
    return;
  }
  throw new Error(`Model Ferry supports macOS and Windows 10 or later; ${platform} is not supported.`);
}

export function restartService(platform = process.platform) {
  if (platform === "darwin") {
    const target = servicePath(platform);
    if (!fs.existsSync(target)) return;
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`]); } catch {}
    return;
  }
  if (platform === "win32") {
    try { execFileSync("schtasks.exe", ["/End", "/TN", windowsTaskName], { stdio: "ignore" }); } catch {}
    try { execFileSync("schtasks.exe", ["/Run", "/TN", windowsTaskName]); } catch {}
    return;
  }
  throw new Error(`Model Ferry supports macOS and Windows 10 or later; ${platform} is not supported.`);
}

export function uninstallService(platform = process.platform) {
  if (platform === "darwin") {
    const target = servicePath(platform);
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["bootout", domain, target], { stdio: "ignore" }); } catch {}
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return;
  }
  if (platform === "win32") {
    try { execFileSync("schtasks.exe", ["/Delete", "/TN", windowsTaskName, "/F"], { stdio: "ignore" }); } catch {}
    return;
  }
  throw new Error(`Model Ferry supports macOS and Windows 10 or later; ${platform} is not supported.`);
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

function windowsTaskXml(node, server, workingDirectory, userId = "CURRENT_USER") {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><URI>${xml(windowsTaskName)}</URI></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
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
  <Actions Context="Author"><Exec><Command>${xml(node)}</Command><Arguments>${xml(`"${server}"`)}</Arguments><WorkingDirectory>${xml(workingDirectory)}</WorkingDirectory></Exec></Actions>
</Task>\n`;
}

function windowsUserId() {
  const output = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" });
  const match = output.match(/"(S-1-[0-9-]+)"\s*$/m);
  if (!match) throw new Error("Could not determine the current Windows user SID for the Model Ferry task.");
  return match[1];
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
