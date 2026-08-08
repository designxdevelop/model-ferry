import test from "node:test";
import assert from "node:assert/strict";
import {
  contentForPendingTool,
  createPendingToolSlot,
  createRunPump,
  waitForToolOrDone
} from "../src/turn.mjs";

test("pending tool slot captures once and resolves waiters", async () => {
  const slot = createPendingToolSlot();
  assert.equal(slot.capture({ name: "bash", arguments: { cmd: "ls" } }), true);
  assert.equal(slot.capture({ name: "other", arguments: {} }), false);
  assert.equal(slot.captured.name, "bash");
  const waiting = slot.waitForResult();
  slot.resolveResult({ content: "ok", isError: false });
  assert.deepEqual(await waiting, { content: "ok", isError: false });
});

test("contentForPendingTool matches OpenAI tool call ids", () => {
  const payload = contentForPendingTool(
    { id: "call_abc", function: { name: "bash" } },
    [{ toolCallId: "call_abc", name: "bash", content: "hello" }]
  );
  assert.equal(payload.content, "hello");
});

test("waitForToolOrDone returns tool without canceling the pump", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  async function* stream() {
    yield { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } };
    await gate;
    yield { type: "assistant", message: { content: [{ type: "text", text: " there" }] } };
  }
  const run = {
    stream: () => stream(),
    wait: async () => ({ status: "finished", result: "hi there" })
  };
  const pump = createRunPump(run);
  let captured = null;
  // Let the first event land, then capture a tool before the stream continues.
  await new Promise((resolve) => setTimeout(resolve, 10));
  captured = { name: "bash", arguments: {} };
  const outcomePromise = waitForToolOrDone(pump, () => captured);
  const outcome = await outcomePromise;
  release();
  assert.equal(outcome.kind, "tool");
  assert.equal(outcome.tool.name, "bash");
  assert.match(outcome.text, /hi/);
});

test("waitForToolOrDone returns done text when no tool is captured", async () => {
  async function* stream() {
    yield { type: "assistant", message: { content: [{ type: "text", text: "done" }] } };
  }
  const run = {
    stream: () => stream(),
    wait: async () => ({ status: "finished", result: "done" })
  };
  const pump = createRunPump(run);
  const outcome = await waitForToolOrDone(pump, () => null);
  assert.equal(outcome.kind, "done");
  assert.equal(outcome.text, "done");
});
