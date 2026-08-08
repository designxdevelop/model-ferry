import test from "node:test";
import assert from "node:assert/strict";
import {
  completionEnvelope,
  conversationStemKey,
  isToolContinuation,
  latestToolResults,
  latestUserText,
  normalizeModel,
  parseTools,
  renderDeltaPrompt,
  renderSeedPrompt,
  renderTranscript,
  requestSessionKey,
  toolsFingerprint
} from "../src/protocol.mjs";

test("normalizes provider-qualified model identifiers", () => {
  assert.equal(normalizeModel("cursorapi/GPT-5.6-Sol"), "gpt-5.6-sol");
});

test("parses OpenAI function tools into MCP tools with stable sort", () => {
  assert.deepEqual(parseTools({
    tools: [
      { type: "function", function: { name: "zsh", parameters: { type: "object" } } },
      { type: "function", function: { name: "bash", parameters: { type: "object" } } }
    ]
  }), [{
    name: "bash",
    description: "Run bash in the outer client.",
    inputSchema: { type: "object" }
  }, {
    name: "zsh",
    description: "Run zsh in the outer client.",
    inputSchema: { type: "object" }
  }]);
  assert.equal(toolsFingerprint([{ name: "b" }, { name: "a" }]), toolsFingerprint([{ name: "a" }, { name: "b" }]));
});

test("renders tool results and keeps client tool ownership explicit", () => {
  const prompt = renderTranscript([{ role: "tool", tool_call_id: "call_1", content: "ok" }], [{ name: "bash" }]);
  assert.match(prompt, /OpenCode owns all tool execution/);
  assert.match(prompt, /TOOL RESULT \(call_1\):\nok/);
});

const SYSTEM_MESSAGE = [
  "You are opencode, the official CLI for OpenCode.",
  "",
  "<env>",
  "  Working directory: /repo",
  "</env>",
  "",
  "Instructions from: /repo/AGENTS.md",
  "Follow the project rules in AGENTS.md.",
  "",
  "<available_skills>",
  "  <skill>",
  "    <id>agent-browser</id>",
  "    <description>Browser automation CLI</description>",
  "  </skill>",
  "  <skill>",
  "    <id>web-perf</id>",
  "    <description>Web performance analysis</description>",
  "  </skill>",
  "</available_skills>"
].join("\n");

test("strips the outer system prompt but keeps skills and project instructions by default", () => {
  const prompt = renderSeedPrompt(
    [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: "hello" }],
    [{ name: "skill" }]
  );
  assert.doesNotMatch(prompt, /You are opencode/);
  assert.doesNotMatch(prompt, /SYSTEM:/);
  assert.doesNotMatch(prompt, /Working directory/);
  assert.match(prompt, /Instructions from: \/repo\/AGENTS\.md/);
  assert.match(prompt, /Follow the project rules in AGENTS\.md/);
  assert.match(prompt, /<available_skills>/);
  assert.match(prompt, /agent-browser/);
  assert.match(prompt, /web-perf/);
  assert.match(prompt, /Use the skill tool to load a skill when a task matches its description/);
});

test("keeps the outer system prompt when stripSystemPrompt is disabled", () => {
  const prompt = renderTranscript(
    [{ role: "system", content: SYSTEM_MESSAGE }, { role: "user", content: "hello" }],
    [],
    { stripSystemPrompt: false }
  );
  assert.match(prompt, /You are opencode/);
  assert.match(prompt, /SYSTEM:\n/);
  assert.match(prompt, /<available_skills>/);
});

test("formats OpenAI tool call envelopes", () => {
  const body = completionEnvelope({ id: "x", model: "composer-2.5", toolCall: { name: "read", arguments: { filePath: "a" } } });
  assert.equal(body.choices[0].finish_reason, "tool_calls");
  assert.equal(body.choices[0].message.tool_calls[0].function.name, "read");
});

test("detects OpenCode tool continuations and extracts results", () => {
  const messages = [
    { role: "user", content: "list files" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", name: "bash", content: "a.txt" }
  ];
  assert.equal(isToolContinuation(messages), true);
  assert.deepEqual(latestToolResults(messages), [{ toolCallId: "call_1", name: "bash", content: "a.txt" }]);
  assert.equal(isToolContinuation([{ role: "user", content: "hi" }]), false);
});

test("delta prompt uses the latest user text", () => {
  assert.equal(latestUserText([{ role: "user", content: "one" }, { role: "assistant", content: "ok" }, { role: "user", content: "two" }]), "two");
  assert.match(renderDeltaPrompt([{ role: "user", content: "follow up" }]), /USER:\nfollow up/);
});

test("prefers OpenCode 2 session headers for sticky keys", () => {
  assert.equal(requestSessionKey({
    headers: {
      "x-session-id": "ses_v2",
      "x-session-affinity": "affinity",
      "x-opencode-session": "legacy"
    }
  }, {}), "ses_v2");
  assert.equal(requestSessionKey({
    headers: { "x-session-affinity": "affinity" }
  }, {}), "affinity");
  assert.equal(requestSessionKey({ headers: {} }, { prompt_cache_key: "pck_1" }), "pck_1");
});

test("conversation stem stays stable across tool hops", () => {
  const first = [
    { role: "system", content: "sys" },
    { role: "user", content: "start" }
  ];
  const later = [
    ...first,
    { role: "assistant", tool_calls: [{ id: "c1", function: { name: "bash", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "ok" }
  ];
  assert.equal(conversationStemKey(first), conversationStemKey(later));
});
