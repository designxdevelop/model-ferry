import test from "node:test";
import assert from "node:assert/strict";
import { completionEnvelope, normalizeModel, parseTools, renderTranscript } from "../src/protocol.mjs";

test("normalizes provider-qualified model identifiers", () => {
  assert.equal(normalizeModel("cursorapi/GPT-5.6-Sol"), "gpt-5.6-sol");
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
