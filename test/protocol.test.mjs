import test from "node:test";
import assert from "node:assert/strict";
import { completionEnvelope, modelSelection, normalizeModel, parseTools, renderTranscript } from "../src/protocol.mjs";

test("normalizes Composer aliases and fast variants", () => {
  assert.equal(normalizeModel("cursorapi/composer-latest"), "composer-2.5");
  assert.deepEqual(modelSelection("composer-2.5-fast"), {
    id: "composer-2.5",
    params: [{ id: "fast", value: "true" }]
  });
});

test("parses OpenAI function tools into MCP tools", () => {
  assert.deepEqual(parseTools({ tools: [{ type: "function", function: { name: "bash", parameters: { type: "object" } } }] }), [{
    name: "bash",
    description: "Run bash in the outer client.",
    inputSchema: { type: "object" }
  }]);
});

test("renders tool results and keeps client tool ownership explicit", () => {
  const prompt = renderTranscript([{ role: "tool", tool_call_id: "call_1", content: "ok" }], [{ name: "bash" }]);
  assert.match(prompt, /OpenCode owns all tool execution/);
  assert.match(prompt, /TOOL RESULT \(call_1\):\nok/);
});

test("formats OpenAI tool call envelopes", () => {
  const body = completionEnvelope({ id: "x", model: "composer-2.5", toolCall: { name: "read", arguments: { filePath: "a" } } });
  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.choices[0].message.tool_calls[0].function.name, "read");
});
