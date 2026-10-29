import test from "node:test";
import assert from "node:assert/strict";
import {
  contentForPendingTool,
  createPendingToolSlot,
  createRunPump,
  cursorRunError,
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

test("waitForToolOrDone surfaces the SDK error message instead of a generic fallback", async () => {
  async function* stream() {}
  const run = {
    stream: () => stream(),
    wait: async () => ({ status: "error", result: "", error: { message: "Authentication error If you are logged in, try logging out and back in." } })
  };
  const pump = createRunPump(run);
  await assert.rejects(
    waitForToolOrDone(pump, () => null),
    (error) => error.message.includes("Authentication error")
  );
});

test("cursorRunError classifies auth failures as 503 not_authenticated", () => {
  const error = cursorRunError({ status: "error", error: { message: "Authentication error If you are logged in, try logging out and back in." } });
  assert.equal(error.status, 503);
  assert.equal(error.code, "not_authenticated");
  assert.match(error.message, /Authentication error/);
});

test("cursorRunError keeps other run failures as 500 and preserves their message", () => {
  const error = cursorRunError({ status: "error", error: { message: "The model returned no output." } });
  assert.equal(error.status, 500);
  assert.equal(error.code, "cursor_run_failed");
  assert.match(error.message, /no output/);
});

test("cursorRunError falls back to a generic message when the SDK provides nothing", () => {
  const error = cursorRunError({ status: "error" });
  assert.equal(error.status, 500);
  assert.equal(error.code, "cursor_run_failed");
  assert.equal(error.message, "Cursor SDK run failed");
});

test("tool result continuation waits for the live pump instead of replaying the call", async () => {
  const slot = createPendingToolSlot();
  const call = { name: "read_marker", arguments: {}, id: "call_marker" };
  async function* stream() {
    yield { type: "assistant", message: { content: [] } };
    const result = await slot.waitForResult();
    yield { type: "assistant", message: { content: [{ type: "text", text: result.content }] } };
  }
  const pump = createRunPump({ stream, wait: async () => ({ status: "finished" }) });
  slot.capture(call);
  assert.equal((await waitForToolOrDone(pump, () => slot.captured)).kind, "tool");
  slot.resolveResult({ content: "FERRY_BOUNDED_TOOL_OK", isError: false });
  const outcome = await waitForToolOrDone(pump, () => slot.captured, { signal: AbortSignal.timeout(1000) });
  assert.equal(outcome.kind, "done");
  assert.equal(outcome.text, "FERRY_BOUNDED_TOOL_OK");
});

test("MCP capture wakes a response waiting on a silent SDK stream", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  async function* stream() { await gate; }
  const pump = createRunPump({ stream, wait: async () => ({ status: "finished" }) });
  const slot = createPendingToolSlot({ onCapture: () => pump.wake() });
  const pending = waitForToolOrDone(pump, () => slot.captured, { signal: AbortSignal.timeout(1000) });
  await new Promise((resolve) => setImmediate(resolve));
  slot.capture({ name: "read_marker", arguments: {}, id: "call_marker" });
  try {
    const outcome = await pending;
    assert.equal(outcome.kind, "tool");
    assert.equal(outcome.tool.id, "call_marker");
  } finally { finish(); }
});

test("MCP can wait for its result after the client has already supplied it", async () => {
  const slot = createPendingToolSlot();
  slot.capture({ name: "read_marker", arguments: {} });
  slot.resolveResult({ content: "marker", isError: false });
  assert.equal(slot.captured, null);
  assert.deepEqual(await slot.waitForResult(), { content: "marker", isError: false });
});
