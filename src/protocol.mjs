import crypto from "node:crypto";

export function normalizeModel(value = "") {
  const raw = String(value).trim();
  const id = raw.toLowerCase().split("/").filter(Boolean).at(-1) || "composer-2.5";
  return id;
}

export function requestSessionKey(request, body) {
  const explicit = [
    request.headers["x-opencode-session-id"],
    request.headers["x-opencode-session"],
    request.headers["x-cursorapi-session"],
    request.headers["x-session-affinity"],
    body.user
  ].find((value) => typeof value === "string" && value.trim());
  if (explicit) return explicit.trim();
  return crypto.createHash("sha256").update(JSON.stringify(body.messages || body.input || [])).digest("hex").slice(0, 24);
}

export function workingDirectory(request) {
  const value = [
    request.headers["x-opencode-directory"],
    request.headers["x-working-directory"],
    request.headers["x-workspace-path"],
    request.headers["x-project-path"],
    process.cwd()
  ].find((item) => typeof item === "string" && item.trim());
  return decodeDirectoryHeader(value.trim());
}

function decodeDirectoryHeader(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseTools(body) {
  return (Array.isArray(body.tools) ? body.tools : []).flatMap((tool) => {
    const fn = tool?.type === "function" ? tool.function : tool;
    if (!fn || typeof fn.name !== "string" || !fn.name.trim()) return [];
    return [{
      name: fn.name.trim(),
      description: typeof fn.description === "string" ? fn.description : `Run ${fn.name} in the outer client.`,
      inputSchema: fn.parameters && typeof fn.parameters === "object"
        ? fn.parameters
        : { type: "object", additionalProperties: true }
    }];
  });
}

const SKILLS_BLOCK = /<available_skills>[\s\S]*?<\/available_skills>/g;
const INSTRUCTION_BLOCK = /Instructions from: [^\n]+\n[\s\S]*?(?=\nInstructions from: |\n<available_skills>|\n<mcp_instructions>|\n<env>|$)/g;

export function renderTranscript(messages = [], tools = [], options = {}) {
  const { stripSystemPrompt = true } = options;
  const toolNames = tools.map((tool) => tool.name).join(", ");
  const instructions = [
    "You are being called through an OpenAI-compatible bridge from OpenCode.",
    "OpenCode owns all tool execution. Never use Cursor's built-in shell, file, search, edit, delete, task, or planning tools.",
    tools.length
      ? `For any action, call exactly one tool from the MCP server named client. Its exact tools are: ${toolNames}.`
      : "No outer tools are available. Answer with text only.",
    "When a TOOL RESULT appears, treat it as the result of your previous tool call and continue.",
    "Do not describe a tool call in prose when a tool is required."
  ].join("\n");

  const sections = [instructions];
  if (stripSystemPrompt) sections.push(...preserveSystemContext(messages));

  const transcript = messages
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

  sections.push(transcript);
  return sections.join("\n\n").trim();
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

function textContent(content) {
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
      arguments: JSON.stringify(toolCall.arguments || {})
    }
  };
}
