#!/usr/bin/env node
/**
 * Probe whether local Cursor Agent.send() retains conversation across turns.
 * Exit 0 and print JSON { ok: true } on PASS; exit 1 with { ok: false } on FAIL.
 *
 * Usage:
 *   node scripts/probe-retention.mjs
 *   MODELFERRY_PROBE_MODEL=composer-2.5 node scripts/probe-retention.mjs
 */
import { Agent } from "@cursor/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";

const modelId = process.env.MODELFERRY_PROBE_MODEL || "composer-2.5";
const cwd = process.env.MODELFERRY_PROBE_CWD || path.dirname(fileURLToPath(import.meta.url));
const token = `ferry-probe-${Date.now().toString(36)}`;

async function collectText(run) {
  let text = "";
  for await (const event of run.stream()) {
    if (event.type !== "assistant") continue;
    for (const block of event.message?.content || []) {
      if (block?.type === "text" && typeof block.text === "string") text += block.text;
    }
  }
  await run.wait();
  return text;
}

async function main() {
  const agent = await Agent.create({
    model: { id: modelId },
    name: "Model Ferry retention probe",
    tools: [],
    local: { cwd, settingSources: [] }
  });
  try {
    const run1 = await agent.send(`Remember this exact token and reply with only: noted\n\nTOKEN=${token}`);
    await collectText(run1);
    const run2 = await agent.send("What was the TOKEN value I asked you to remember? Reply with only TOKEN=<value>");
    const text2 = await collectText(run2);
    const ok = text2.includes(token);
    const payload = { ok, modelId, recalled: ok, sample: text2.slice(0, 200) };
    console.log(JSON.stringify(payload));
    process.exit(ok ? 0 : 1);
  } finally {
    try { agent.close(); } catch {}
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ ok: false, error: error.message }));
  process.exit(1);
});
