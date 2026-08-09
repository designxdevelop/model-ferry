import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

export const serviceLabel = "ai.dxd.modelferry";

export function serviceManager(platform = process.platform) {
  if (platform === "darwin") return "launchd";
  if (platform === "linux") return "systemd";
  throw new Error(`Model Ferry supports macOS and Linux; ${platform} is not supported.`);
}

export function servicePath(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") return path.join(home, "Library", "LaunchAgents", `${serviceLabel}.plist`);
  if (platform === "linux") return path.join(home, ".config", "systemd", "user", `${serviceLabel}.service`);
  throw new Error(`Model Ferry supports macOS and Linux; ${platform} is not supported.`);
}

export function serviceDefinition({
  platform = process.platform,
  node = process.execPath,
  server,
  workingDirectory
}) {
  if (platform === "darwin") return launchdPlist(node, server, workingDirectory);
  if (platform === "linux") return systemdUnit(node, server, workingDirectory);
  throw new Error(`Model Ferry supports macOS and Linux; ${platform} is not supported.`);
}

export function installService({
  platform = process.platform,
  node = process.execPath,
  server,
  workingDirectory
}) {
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
  if (platform === "linux") {
    execFileSync("systemctl", ["--user", "daemon-reload"]);
    execFileSync("systemctl", ["--user", "enable", "--now", `${serviceLabel}.service`]);
    return;
  }
  throw new Error(`Model Ferry supports macOS and Linux; ${platform} is not supported.`);
}

export function restartService(platform = process.platform) {
  const target = servicePath(platform);
  if (!fs.existsSync(target)) return;
  if (platform === "darwin") {
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["kickstart", "-k", `${domain}/${serviceLabel}`]); } catch {}
    return;
  }
  if (platform === "linux") {
    try { execFileSync("systemctl", ["--user", "restart", `${serviceLabel}.service`]); } catch {}
    return;
  }
  throw new Error(`Model Ferry supports macOS and Linux; ${platform} is not supported.`);
}

export function uninstallService(platform = process.platform) {
  const target = servicePath(platform);
  if (platform === "darwin") {
    const domain = `gui/${process.getuid()}`;
    try { execFileSync("/bin/launchctl", ["bootout", domain, target], { stdio: "ignore" }); } catch {}
  } else if (platform === "linux") {
    try { execFileSync("systemctl", ["--user", "disable", "--now", `${serviceLabel}.service`], { stdio: "ignore" }); } catch {}
  } else {
    throw new Error(`Model Ferry supports macOS and Linux; ${platform} is not supported.`);
  }
  if (fs.existsSync(target)) fs.unlinkSync(target);
  if (platform === "linux") {
    try { execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" }); } catch {}
  }
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
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function xml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function systemdEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(" ", "\\x20");
}
