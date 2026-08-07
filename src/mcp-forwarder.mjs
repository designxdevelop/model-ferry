#!/usr/bin/env node
import readline from "node:readline";

const tools = safeJson(process.env.MODELFERRY_TOOLS, []);
const callbackUrl = process.env.MODELFERRY_CALLBACK_URL || "";
const callbackToken = process.env.MODELFERRY_CALLBACK_TOKEN || "";
const captureId = process.env.MODELFERRY_CAPTURE_ID || "";
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === "initialize") {
    reply(message.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "modelferry-client-tools", version: "0.1.0" }
    });
    return;
  }
  if (message.method === "tools/list") {
    reply(message.id, { tools });
    return;
  }
  if (message.method === "tools/call") {
    const name = message.params?.name || message.params?.toolName;
    const args = message.params?.arguments || message.params?.input || {};
    if (!tools.some((tool) => tool.name === name)) {
      fail(message.id, `Unknown outer-client tool: ${name}`);
      return;
    }
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${callbackToken}` },
        body: JSON.stringify({ captureId, name, arguments: args })
      });
      if (!response.ok) throw new Error(`callback returned ${response.status}`);
      reply(message.id, { content: [{ type: "text", text: "FORWARDED_TO_OPENCODE" }], isError: false });
    } catch (error) {
      fail(message.id, `Could not forward tool call: ${error.message}`);
    }
    return;
  }
  if (message.id != null) fail(message.id, `Unsupported MCP method: ${message.method}`);
});

function reply(id, result) {
  if (id != null) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, message) {
  if (id != null) process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } })}\n`);
}

function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}
