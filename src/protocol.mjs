import crypto from "node:crypto";

export function normalizeModel(value = "") {
  const raw = String(value).trim();
  const id = raw.toLowerCase().split("/").filter(Boolean).at(-1) || "composer-2.5";
  return id;
}

/**
 * Sticky session identity. Prefer explicit client session headers; otherwise
 * hash the conversation stem (through the first user message) so tool hops
 * and follow-ups in the same chat reuse one Agent.
 */
/**
 * Sticky session identity for OpenCode 1.x/2.0 cache affinity.
 * Prefers OpenCode 2 session headers (X-Session-Id, x-session-affinity),
 * then legacy x-opencode-session*, then body.prompt_cache_key / body.user.
 */
export function requestSessionKey(request, body) {
  const headers = request.headers || {};
  const explicit = [
    headers["x-session-id"],
    headers["x-session-affinity"],
    headers["x-opencode-session-id"],
    headers["x-opencode-session"],
    headers["x-cursorapi-session"],
    typeof body?.prompt_cache_key === "string" ? body.prompt_cache_key : null,
    typeof body?.promptCacheKey === "string" ? body.promptCacheKey : null,
    body?.user
  ].find((value) => typeof value === "string" && value.trim());
  if (explicit) return explicit.trim();
  return conversationStemKey(body.messages || body.input || []);
}

/** Parent session for OpenCode 2 sub-agents (informational; used in session metadata). */
export function requestParentSessionKey(request) {
  const headers = request.headers || {};
  const value = headers["x-parent-session-id"] || headers["X-Parent-Session-Id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function conversationStemKey(messages = []) {
  const stem = [];
  for (const message of messages) {
    stem.push(message);
    if (String(message?.role || "").toLowerCase() === "user") break;
  }
  return crypto.createHash("sha256").update(JSON.stringify(stem)).digest("hex").slice(0, 24);
}

export function workingDirectory(request, body = {}) {
  const value = [
    request.headers["x-opencode-directory"],
    request.headers["x-working-directory"],
    request.headers["x-workspace-path"],
    request.headers["x-project-path"],
    systemWorkingDirectory(body.messages),
    process.cwd()
  ].find((item) => typeof item === "string" && item.trim());
  return decodeDirectoryHeader(value.trim());
}

function systemWorkingDirectory(messages) {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    if (message?.role !== "system" || typeof message.content !== "string") continue;
    const match = message.content.match(/<env>[\s\S]*?^\s*Working directory:\s*(.+?)\s*$/m);
    if (match?.[1]) return match[1];
  }
  return null;
}

function decodeDirectoryHeader(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseTools(body) {
  return sortTools((Array.isArray(body.tools) ? body.tools : []).flatMap((tool) => {
    const fn = tool?.type === "function" ? tool.function : tool;
    if (!fn || typeof fn.name !== "string" || !fn.name.trim()) return [];
    return [{
      name: fn.name.trim(),
      description: typeof fn.description === "string" ? fn.description : `Run ${fn.name} in the outer client.`,
      inputSchema: fn.parameters && typeof fn.parameters === "object"
        ? fn.parameters
        : { type: "object", additionalProperties: true }
    }];
  }));
}

export function sortTools(tools = []) {
  return [...tools].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export function toolsFingerprint(tools = []) {
  return crypto.createHash("sha256").update(JSON.stringify(sortTools(tools))).digest("hex").slice(0, 16);
}

const SKILLS_BLOCK = /<available_skills>[\s\S]*?<\/available_skills>/g;
const INSTRUCTION_BLOCK = /Instructions from: [^\n]+\n[\s\S]*?(?=\nInstructions from: |\n<available_skills>|\n<mcp_instructions>|\n<env>|$)/g;

/** @deprecated Prefer renderSeedPrompt; kept as stable alias for full seed renders. */
export function renderTranscript(messages = [], tools = [], options = {}) {
  return renderSeedPrompt(messages, tools, options);
}

/**
 * Cache-stable seed for the first send of an agentic loop: fixed bridge
 * instructions, sorted tool names, skills/AGENTS, then the non-system transcript.
 */
export function renderSeedPrompt(messages = [], tools = [], options = {}) {
  const { stripSystemPrompt = true } = options;
  const sorted = sortTools(tools);
  const toolNames = sorted.map((tool) => tool.name).join(", ");
  const instructions = [
    "You are being called through an OpenAI-compatible bridge from OpenCode.",
    "OpenCode owns all tool execution. Never use Cursor's built-in shell, file, search, edit, delete, task, or planning tools.",
    sorted.length
      ? `For any action, call exactly one tool from the MCP server named client. Its exact tools are: ${toolNames}.`
      : "No outer tools are available. Answer with text only.",
    "When a tool result is returned through MCP, continue the task. Do not expect TOOL RESULT text in the user prompt on later hops.",
    "Do not describe a tool call in prose when a tool is required."
  ].join("\n");

  const sections = [instructions];
  if (stripSystemPrompt) sections.push(...preserveSystemContext(messages));

  const transcript = formatTranscriptMessages(messages, { stripSystemPrompt });
  if (transcript) sections.push(transcript);
  return sections.join("\n\n").trim();
}

/** Delta follow-up when the Agent retains prior turns. */
export function renderDeltaPrompt(messages = [], options = {}) {
  const { stripSystemPrompt = true } = options;
  const text = latestUserText(messages);
  if (text) return `USER:\n${text}`;
  const transcript = formatTranscriptMessages(messages, { stripSystemPrompt });
  return transcript || "USER:\nContinue.";
}

export function isToolContinuation(messages = []) {
  if (!Array.isArray(messages) || !messages.length) return false;
  let i = messages.length - 1;
  while (i >= 0 && isSystemMessage(messages[i])) i -= 1;
  if (i < 0) return false;
  if (String(messages[i]?.role || "").toLowerCase() !== "tool") return false;
  while (i >= 0 && String(messages[i]?.role || "").toLowerCase() === "tool") i -= 1;
  if (i < 0) return false;
  const prior = messages[i];
  return String(prior?.role || "").toLowerCase() === "assistant"
    && Array.isArray(prior.tool_calls)
    && prior.tool_calls.length > 0;
}

export function latestToolResults(messages = []) {
  const results = [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (isSystemMessage(message)) continue;
    if (String(message?.role || "").toLowerCase() !== "tool") break;
    results.unshift({
      toolCallId: message.tool_call_id || message.name || "",
      name: message.name || "",
      content: textContent(message.content)
    });
  }
  return results;
}

export function latestUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (String(message?.role || "").toLowerCase() !== "user") continue;
    return textContent(message.content);
  }
  return "";
}

function formatTranscriptMessages(messages = [], { stripSystemPrompt = true } = {}) {
  return messages
    .filter((message) => !stripSystemPrompt || !isSystemMessage(message))
    .map((message) => {
      const role = String(message?.role || "user").toUpperCase();
      if (role === "TOOL") {
        return `TOOL RESULT (${message.tool_call_id || message.name || "unknown"}):\n${textContent(message.content)}`;
      }
      if (role === "ASSISTANT" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
        const calls = message.tool_calls.map((call) => `${call.function?.name || "tool"}(${call.function?.arguments || "{}"})`).join("\n");
        return `ASSISTANT TOOL CALL:\n${calls}`;
      }
      return `${role}:\n${textContent(message?.content)}`;
    }).join("\n\n");
}

function isSystemMessage(message) {
  return String(message?.role || "").toLowerCase() === "system";
}

function preserveSystemContext(messages) {
  const sections = [];
  for (const message of messages) {
    if (!isSystemMessage(message)) continue;
    const content = textContent(message?.content);
    for (const match of content.matchAll(SKILLS_BLOCK)) {
      sections.push(`Skills provide specialized instructions and workflows for specific tasks. Use the skill tool to load a skill when a task matches its description.\n${match[0].trim()}`);
    }
    for (const match of content.matchAll(INSTRUCTION_BLOCK)) {
      sections.push(match[0].trim());
    }
  }
  return [...new Set(sections)];
}

export function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text" || part?.type === "input_text") return part.text || "";
    if (part?.type === "image_url") return `[image: ${part.image_url?.url || "attached"}]`;
    return JSON.stringify(part);
  }).join("\n");
}

export function completionEnvelope({ id, model, text = "", toolCall = null }) {
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: toolCall ? null : text,
        ...(toolCall ? { tool_calls: [openAiToolCall(toolCall)] } : {})
      },
      finish_reason: toolCall ? "tool_calls" : "stop"
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

export function openAiToolCall(toolCall) {
  return {
    id: toolCall.id || `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: typeof toolCall.arguments === "string"
        ? toolCall.arguments
        : JSON.stringify(toolCall.arguments || {})
    }
  };
}
