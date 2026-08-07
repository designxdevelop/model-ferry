#!/usr/bin/env node
import { Agent } from "@cursor/sdk";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authStatus } from "./auth.mjs";
import { loadConfig } from "./config.mjs";
import { buildRegistry, catalogSummary, fetchCatalog, loadCatalog, providerModels, resolveSelection, syncOpenCodeConfig } from "./catalog.mjs";
import {
  completionEnvelope,
  normalizeModel,
  openAiToolCall,
  parseTools,
  renderTranscript,
  requestSessionKey,
  workingDirectory
} from "./protocol.mjs";

const config = loadConfig();
const sessions = new Map();
const captures = new Map();
const callbackToken = crypto.randomBytes(24).toString("hex");
const forwarderPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-forwarder.mjs");
let catalogState = null;
let registry = { models: [], selections: new Map() };
let lastRefreshError = null;
let refreshInFlight = null;

try {
  catalogState = await loadCatalog();
  registry = buildRegistry(catalogState.catalog);
  syncOpenCodeConfig(registry, config);
  lastRefreshError = catalogState.error || null;
} catch (error) {
  lastRefreshError = error.message;
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => sendError(response, error));
});

server.listen(config.port, config.host, () => {
  console.log(`Model Ferry listening on http://${config.host}:${config.port}/v1`);
});

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${config.host}:${config.port}`}`);
  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    const auth = await authStatus();
    const authenticated = auth.status === "logged-in";
    return json(response, 200, {
      ok: authenticated && registry.models.length > 0,
      ready: authenticated && registry.models.length > 0,
      service: "Model Ferry",
      status: !authenticated ? "not_authenticated" : registry.models.length ? "ready" : "missing_model_catalog",
      auth: {
        status: auth.status,
        ...(auth.via ? { via: auth.via } : {}),
        ...(auth.email ? { email: auth.email } : {})
      },
      catalog: catalogState ? { ...catalogSummary(catalogState, registry), lastRefreshError } : null,
      sessions: sessions.size
    });
  }
  if (request.method === "GET" && url.pathname === "/v1/models") {
    requireLocalAuth(request);
    return json(response, 200, {
      object: "list",
      data: Object.entries(providerModels(registry, { exposeVariantAliases: config.exposeVariantAliases })).map(([id, metadata]) => ({
        id, object: "model", created: 0, owned_by: "cursor", name: metadata.name
      }))
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/catalog/refresh") {
    requireLocalAuth(request);
    const result = await refreshCatalog();
    return json(response, 200, { ok: true, changed: result.changed, catalog: catalogSummary(catalogState, registry) });
  }
  if (request.method === "POST" && url.pathname === "/internal/tool-capture") {
    if (bearer(request) !== callbackToken) throw httpError(401, "Invalid callback token", "unauthorized");
    const body = await readJson(request);
    const capture = captures.get(body.captureId);
    if (!capture) throw httpError(404, "Tool capture no longer active", "capture_expired");
    capture({ name: body.name, arguments: body.arguments || {} });
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    requireLocalAuth(request);
    if (!(await authenticated())) throw httpError(503, "Cursor is not authenticated. Run `npm run setup` to sign in.", "not_authenticated");
    return chatCompletion(request, response, await readJson(request));
  }
  throw httpError(404, "Not found", "not_found");
}

async function chatCompletion(request, response, body) {
  const model = normalizeModel(body.model);
  const selection = resolveSelection(registry, model, body);
  if (!selection) throw httpError(400, `Unsupported model or variant: ${model}`, "unsupported_model");
  const tools = parseTools(body);
  const sessionKey = `${requestSessionKey(request, body)}\0${JSON.stringify(selection)}\0${workingDirectory(request)}`;
  const session = await getSession(sessionKey, selection, workingDirectory(request));
  const prompt = renderTranscript(body.messages || [], tools);
  const captureId = crypto.randomUUID();
  let capturedTool = null;
  let activeRun = null;
  captures.set(captureId, (tool) => {
    if (capturedTool) return;
    capturedTool = tool;
    activeRun?.cancel().catch(() => {});
  });

  const mcpServers = tools.length ? {
    client: {
      type: "stdio",
      command: process.execPath,
      args: [forwarderPath],
      env: {
        MODELFERRY_TOOLS: JSON.stringify(tools),
        MODELFERRY_CALLBACK_URL: `http://${config.host}:${config.port}/internal/tool-capture`,
        MODELFERRY_CALLBACK_TOKEN: callbackToken,
        MODELFERRY_CAPTURE_ID: captureId
      }
    }
  } : undefined;

  const timeout = AbortSignal.timeout(config.requestTimeoutMs);
  try {
    const runPromise = session.agent.send(prompt, {
      model: selection,
      ...(mcpServers ? { mcpServers } : {}),
      ...(session.force ? { local: { force: true } } : {}),
      idempotencyKey: crypto.randomUUID()
    });
    activeRun = await Promise.race([runPromise, abortPromise(timeout)]);
    session.force = false;
    touchSession(sessionKey, session);
    if (body.stream === true) return await streamRun(response, activeRun, model, captureId, () => capturedTool, session);
    const output = await collectRun(activeRun, () => capturedTool);
    if (output.toolCall) session.force = true;
    return json(response, 200, completionEnvelope({ id: `chatcmpl-${activeRun.id}`, model, text: output.text, toolCall: output.toolCall }));
  } finally {
    if (body.stream !== true) captures.delete(captureId);
  }
}

async function collectRun(run, capturedTool) {
  let text = "";
  try {
    for await (const event of run.stream()) {
      if (event.type !== "assistant") continue;
      for (const block of event.message?.content || []) {
        if (block?.type === "text" && typeof block.text === "string") text += block.text;
      }
      if (capturedTool()) break;
    }
  } catch (error) {
    if (!capturedTool()) throw error;
  }
  if (capturedTool()) return { text: "", toolCall: capturedTool() };
  const result = await run.wait();
  if (result.status === "error") throw new Error(result.result || "Cursor SDK run failed");
  return { text: text || result.result || "", toolCall: null };
}

async function streamRun(response, run, model, captureId, capturedTool, session) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const id = `chatcmpl-${run.id}`;
  const chunk = (delta, finishReason = null) => response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`);
  chunk({ role: "assistant", content: "" });
  try {
    for await (const event of run.stream()) {
      if (event.type !== "assistant") continue;
      for (const block of event.message?.content || []) {
        if (block?.type === "text" && block.text) chunk({ content: block.text });
      }
      if (capturedTool()) break;
    }
    const tool = capturedTool();
    if (tool) {
      session.force = true;
      const call = openAiToolCall(tool);
      chunk({ tool_calls: [{ index: 0, ...call }] }, "tool_calls");
    } else {
      await run.wait();
      chunk({}, "stop");
    }
    response.end("data: [DONE]\n\n");
  } catch (error) {
    if (!response.writableEnded) response.end(`data: ${JSON.stringify({ error: apiError(error) })}\n\ndata: [DONE]\n\n`);
  } finally {
    captures.delete(captureId);
  }
}

async function getSession(key, selection, cwd) {
  const existing = sessions.get(key);
  if (existing) return existing;
  const agent = await Agent.create({
    model: selection,
    name: "OpenCode Model Ferry",
    local: { cwd, settingSources: [] }
  });
  const session = { agent, touchedAt: Date.now(), force: false };
  sessions.set(key, session);
  evictSessions();
  return session;
}

async function refreshCatalog() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performCatalogRefresh();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function performCatalogRefresh() {
  try {
    const nextState = await fetchCatalog();
    const nextRegistry = buildRegistry(nextState.catalog);
    const catalogChanged = JSON.stringify(catalogState?.catalog) !== JSON.stringify(nextState.catalog);
    const configResult = syncOpenCodeConfig(nextRegistry, config);
    catalogState = nextState;
    registry = nextRegistry;
    lastRefreshError = null;
    return { changed: catalogChanged || configResult.changed };
  } catch (error) {
    lastRefreshError = error.message;
    throw error;
  }
}

function touchSession(key, session) {
  session.touchedAt = Date.now();
  sessions.delete(key);
  sessions.set(key, session);
}

function evictSessions() {
  while (sessions.size > config.maxSessions) {
    const [key, session] = sessions.entries().next().value;
    sessions.delete(key);
    try { session.agent.close(); } catch {}
  }
}

function requireLocalAuth(request) {
  if (bearer(request) !== config.localToken) throw httpError(401, "Missing or invalid authorization", "unauthorized");
}

async function authenticated() {
  return (await authStatus()).status === "logged-in";
}

function bearer(request) {
  return String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 2_000_000) throw httpError(413, "Request body too large", "request_too_large");
  }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw httpError(400, "Invalid JSON", "invalid_json"); }
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendError(response, error) {
  if (response.headersSent) return response.end();
  json(response, error.status || 500, { error: apiError(error) });
}

function apiError(error) {
  return { message: error.message || "Internal error", type: "modelferry_error", code: error.code || "internal_error" };
}

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function abortPromise(signal) {
  return new Promise((_, reject) => signal.addEventListener("abort", () => reject(httpError(504, "Cursor SDK request timed out", "timeout")), { once: true }));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    for (const { agent } of sessions.values()) try { agent.close(); } catch {}
    process.exit(0);
  });
}

if (config.catalogRefreshMs > 0) {
  const refreshTimer = setInterval(() => refreshCatalog().catch((error) => {
    console.error(`Model catalog refresh failed: ${error.message}`);
  }), config.catalogRefreshMs);
  refreshTimer.unref();
}
