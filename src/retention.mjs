import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateConfig } from "./config.mjs";

const probePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "probe-retention.mjs");

/**
 * Resolve whether local agents retain context across send().
 * Uses cached config.retentionOk when set; otherwise runs the probe once
 * and persists the result.
 */
export async function resolveRetentionOk(config, { force = false, timeoutMs = 120_000 } = {}) {
  if (!force && typeof config.retentionOk === "boolean") return config.retentionOk;
  const result = await runRetentionProbe({ timeoutMs });
  try {
    updateConfig({ retentionOk: result.ok, retentionProbedAt: Date.now() });
  } catch {}
  config.retentionOk = result.ok;
  config.retentionProbedAt = Date.now();
  return result.ok;
}

export function runRetentionProbe({ timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probePath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "probe timed out" });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const line = stdout.trim().split("\n").filter(Boolean).at(-1) || "{}";
        const payload = JSON.parse(line);
        resolve({ ok: Boolean(payload.ok), ...payload, exitCode: code, stderr: stderr.slice(0, 500) });
      } catch {
        resolve({ ok: false, error: "invalid probe output", stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 500), exitCode: code });
      }
    });
  });
}
