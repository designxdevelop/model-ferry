import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

// Detection markers follow the public agents registry used by the Skills CLI,
// with command names added for CLIs that may not have created config yet.
// A detected harness is not automatically assumed to accept a custom provider.
export const harnessRegistry = [
  automatic("opencode", "OpenCode", ["opencode"], [".config/opencode"]),
  automatic("pi", "Pi", ["pi"], [".pi/agent"]),
  automatic("hermes-agent", "Hermes Agent", ["hermes"], [".hermes"]),
  detected("aider-desk", "AiderDesk", ["aider-desk"], [".aider-desk"]),
  detected("amp", "Amp", ["amp"], [".config/amp"]),
  detected("antigravity", "Antigravity", [], [".gemini/antigravity"]),
  detected("augment", "Augment", [], [".augment"]),
  detected("claude-code", "Claude Code", ["claude"], [".claude"]),
  detected("cline", "Cline", [], [".cline"]),
  detected("codebuddy", "CodeBuddy", ["codebuddy"], [".codebuddy"]),
  detected("codemaker", "Codemaker", ["codemaker"], [".codemaker"]),
  detected("codex", "Codex", ["codex"], [".codex"]),
  detected("continue", "Continue", ["cn"], [".continue"]),
  detected("crush", "Crush", ["crush"], [".config/crush"]),
  detected("cursor", "Cursor", ["cursor", "cursor-agent"], [".cursor"]),
  detected("deepagents", "Deep Agents", ["deepagents"], [".deepagents"]),
  detected("devin", "Devin for Terminal", ["devin"], [".config/devin"]),
  detected("dexto", "Dexto", ["dexto"], [".dexto"]),
  detected("droid", "Droid", ["droid"], [".factory"]),
  detected("forgecode", "ForgeCode", ["forge"], [".forge"]),
  detected("gemini-cli", "Gemini CLI", ["gemini"], [".gemini"]),
  detected("github-copilot", "GitHub Copilot", ["copilot"], [".copilot"]),
  detected("goose", "Goose", ["goose"], [".config/goose"]),
  detected("iflow-cli", "iFlow CLI", ["iflow"], [".iflow"]),
  detected("junie", "Junie", [], [".junie"]),
  detected("kilo", "Kilo Code", ["kilo"], [".kilocode"]),
  detected("kimi-code-cli", "Kimi Code CLI", ["kimi"], [".kimi-code", ".kimi"]),
  detected("kiro-cli", "Kiro CLI", ["kiro-cli"], [".kiro"]),
  detected("mcpjam", "MCPJam", ["mcpjam"], [".mcpjam"]),
  detected("mistral-vibe", "Mistral Vibe", ["vibe"], [".vibe"]),
  detected("mux", "Mux", ["mux"], [".mux"]),
  detected("openclaw", "OpenClaw", ["openclaw"], [".openclaw", ".clawdbot", ".moltbot"]),
  detected("openhands", "OpenHands", ["openhands"], [".openhands"]),
  detected("qoder", "Qoder", ["qoder"], [".qoder"]),
  detected("qwen-code", "Qwen Code", ["qwen"], [".qwen"]),
  detected("roo", "Roo Code", [], [".roo"]),
  detected("rovodev", "Rovo Dev", ["rovodev"], [".rovodev"]),
  detected("tabnine-cli", "Tabnine CLI", ["tabnine"], [".tabnine"]),
  detected("trae", "Trae", [], [".trae"]),
  detected("warp", "Warp", ["warp-terminal"], [".warp"]),
  detected("windsurf", "Windsurf", [], [".codeium/windsurf"]),
  detected("zed", "Zed", ["zed"], [".config/zed"]),
  detected("zencoder", "Zencoder", ["zencoder"], [".zencoder"])
];

export function discoverHarnesses(options = {}) {
  return harnessRegistry.map((harness) => inspectHarness(harness, options));
}

export function discoverInstalledHarnesses(options = {}) {
  return discoverHarnesses(options).filter((harness) => harness.installed);
}

export function isHarnessInstalled(id, options = {}) {
  const harness = harnessRegistry.find((candidate) => candidate.id === id);
  return harness ? inspectHarness(harness, options).installed : false;
}

function inspectHarness(harness, {
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync
} = {}) {
  const commands = harness.commands.filter((command) => commandOnPath(command, { env, platform, exists }));
  const configPaths = harness.configPaths
    .map((marker) => resolveMarker(marker, { home, env, platform }))
    .filter(Boolean)
    .filter((marker) => exists(marker));
  return {
    ...harness,
    installed: commands.length > 0 || configPaths.length > 0,
    foundBy: { commands, configPaths }
  };
}

function resolveMarker(marker, { home, env, platform }) {
  if (marker === ".codex" && env.CODEX_HOME?.trim()) return env.CODEX_HOME.trim();
  if (marker === ".claude" && env.CLAUDE_CONFIG_DIR?.trim()) return env.CLAUDE_CONFIG_DIR.trim();
  if (marker === ".hermes" && env.HERMES_HOME?.trim()) return env.HERMES_HOME.trim();
  if (platform === "win32" && marker.startsWith(".config/")) {
    // OpenCode uses %USERPROFILE%\.config\opencode (same as openCodeConfigPath), not %APPDATA%.
    if (marker === ".config/opencode") {
      return path.win32.join(home, ...marker.split("/"));
    }
    const appData = env.APPDATA?.trim() || path.win32.join(home, "AppData", "Roaming");
    return path.win32.join(appData, ...marker.slice(".config/".length).split("/"));
  }
  if (platform === "win32" && marker === ".hermes") {
    const localAppData = env.LOCALAPPDATA?.trim() || path.win32.join(home, "AppData", "Local");
    return path.win32.join(localAppData, "hermes");
  }
  const platformPath = platform === "win32" ? path.win32 : path;
  return platformPath.join(home, ...marker.split("/"));
}

function commandOnPath(command, { env, platform, exists }) {
  const platformPath = platform === "win32" ? path.win32 : path;
  const extensions = platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  return (env.PATH || "").split(platformPath.delimiter).filter(Boolean).some((directory) =>
    extensions.some((extension) => {
      const candidate = platformPath.join(directory, `${command}${extension}`);
      return exists(candidate) || (extension && exists(platformPath.join(directory, `${command}${extension.toLowerCase()}`)));
    })
  );
}

function automatic(id, displayName, commands, configPaths) {
  return { id, displayName, commands, configPaths, setup: "automatic" };
}

function detected(id, displayName, commands, configPaths) {
  return { id, displayName, commands, configPaths, setup: "detected-only" };
}
