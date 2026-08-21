#!/usr/bin/env node
import { Agent, Cursor } from "@cursor/sdk";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authStatus, login as renewLogin, needsRenewal } from "./auth.mjs";
import { ensureConfig, updateConfig } from "./config.mjs";
import { buildRegistry, catalogSummary, fetchCatalog, loadCatalog, providerModels, resolveSelection, syncOpenCodeConfig } from "./catalog.mjs";
import { syncInstalledAgentConfigs } from "./clients.mjs";
import { renderOnboardingPage } from "./onboard.mjs";
import {
  completionEnvelope,
  isToolContinuation,
  latestToolResults,
  normalizeModel,
  openAiToolCall,
  parseTools,
  renderDeltaPrompt,
  renderSeedPrompt,
  requestParentSessionKey,
  requestSessionKey,
  toolsFingerprint,
  workingDirectory
} from "./protocol.mjs";
import { resolveRetentionOk } from "./retention.mjs";
import {
  contentForPendingTool,
  createPendingToolSlot,
  createRunPump,
  waitForToolOrDone
} from "./turn.mjs";

const config = ensureConfig();
const sessions = new Map();
/** @type {Map<string, { slot: ReturnType<typeof createPendingToolSlot>, openAiCall: object }>} */
const captures = new Map();
const callbackToken = crypto.randomBytes(24).toString("hex");
const forwarderPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-forwarder.mjs");
let catalogState = null;
let registry = { models: [], selections: new Map() };
let lastRefreshError = null;
let refreshInFlight = null;
let authLoginInFlight = null;
let lastAuthError = null;

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => sendError(response, error));
});

const requestedPort = config.port;
const resolvedPort = await listenWithFallback(server, requestedPort, config.host);
if (resolvedPort !== requestedPort) {
  config.port = resolvedPort;
  persistPort(resolvedPort);
  console.log(`Port ${requestedPort} was in use; using ${resolvedPort} instead.`);
}
console.log(`Model Ferry listening on http://${config.host}:${resolvedPort}/v1`);

try {
  catalogState = await loadCatalog();
  registry = buildRegistry(catalogState.catalog);
  syncOpenCodeConfig(registry, config);
  reportAgentConfigErrors(syncInstalledAgentConfigs(registry, config));
  lastRefreshError = catalogState.error || null;
} catch (error) {
  lastRefreshError = error.message;
}
maybeRenewAuth().catch(() => {});
resolveRetentionOk(config).then((ok) => {
  console.log(`Local Agent retention probe: ${ok ? "PASS (delta follow-ups enabled)" : "FAIL (full seed each user turn)"}`);
}).catch((error) => {
  console.log(`Local Agent retention probe skipped: ${error.message}`);
  config.retentionOk = false;
});

function listenWithFallback(server, initialPort, host, maxTries = 20) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const onError = (error) => {
      if (error.code === "EADDRINUSE" && attempt < maxTries - 1) {
        attempt += 1;
        server.listen(initialPort + attempt, host);
      } else {
        server.removeListener("listening", onListening);
        reject(error);
      }
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve(initialPort + attempt);
    };
    server.on("error", onError);
    server.once("listening", onListening);
    server.listen(initialPort, host);
  });
}

function persistPort(port) {
  try {
    Object.assign(config, updateConfig({ port }));
  } catch {}
}

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
        ...(auth.email ? { email: auth.email } : {}),
        ...(auth.apiKeyExpiresAtMs ? { apiKeyExpiresAtMs: auth.apiKeyExpiresAtMs } : {}),
        ...(authLoginInFlight ? { renewing: true } : {})
      },
      catalog: catalogState ? { ...catalogSummary(catalogState, registry), lastRefreshError } : null,
      sessions: sessions.size,
      retentionOk: config.retentionOk ?? null
    });
  }
  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/onboard")) {
    return html(response, 200, renderOnboardingPage(config.localToken));
  }
  if (request.method === "GET" && url.pathname === "/v1/auth/status") {
    requireLocalAuth(request);
    const auth = await authStatus();
    return json(response, 200, {
      ...auth,
      renewing: Boolean(authLoginInFlight),
      lastAuthError,
      ready: auth.status === "logged-in" && registry.models.length > 0,
      stripSystemPrompt: config.stripSystemPrompt,
      retentionOk: config.retentionOk ?? null,
      catalog: catalogState ? catalogSummary(catalogState, registry) : null
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/config") {
    requireLocalAuth(request);
    const body = await readJson(request);
    const patch = {};
    if (typeof body.stripSystemPrompt === "boolean") patch.stripSystemPrompt = body.stripSystemPrompt;
    if (typeof body.retentionOk === "boolean") patch.retentionOk = body.retentionOk;
    if (Object.keys(patch).length) Object.assign(config, updateConfig(patch));
    return json(response, 200, {
      stripSystemPrompt: config.stripSystemPrompt,
      retentionOk: config.retentionOk ?? null
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/login") {
    requireLocalAuth(request);
    startAuthLogin();
    return json(response, 200, { started: true });
  }
  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    requireLocalAuth(request);
    await Cursor.auth.logout();
    return json(response, 200, { ok: true });
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
    const entry = captures.get(body.captureId);
    if (!entry) throw httpError(404, "Tool capture no longer active", "capture_expired");
    const tool = { name: body.name, arguments: body.arguments || {}, id: entry.openAiCall.id };
    entry.slot.capture(tool);
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && url.pathname === "/internal/tool-wait") {
    if (bearer(request) !== callbackToken) throw httpError(401, "Invalid callback token", "unauthorized");
    const body = await readJson(request);
    const entry = captures.get(body.captureId);
    if (!entry) throw httpError(404, "Tool wait no longer active", "capture_expired");
    try {
      const payload = await entry.slot.waitForResult();
      return json(response, 200, payload);
    } catch (error) {
      throw httpError(504, error.message || "Tool wait failed", "tool_wait_failed");
    }
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    requireLocalAuth(request);
    await requireChatAuth();
    return chatCompletion(request, response, await readJson(request));
  }
  throw httpError(404, "Not found", "not_found");
}

async function chatCompletion(request, response, body) {
  const model = normalizeModel(body.model);
  const selection = resolveSelection(registry, model, body);
  if (!selection) throw httpError(400, `Unsupported model or variant: ${model}`, "unsupported_model");
  const tools = parseTools(body);
  const cwd = workingDirectory(request, body);
  const parentSession = requestParentSessionKey(request);
  const sessionKey = `${requestSessionKey(request, body)}\0${JSON.stringify(selection)}\0${cwd}`;
  const session = await getSession(sessionKey, selection, cwd, parentSession);
  const messages = body.messages || [];
  const timeout = AbortSignal.timeout(config.requestTimeoutMs);

  // OpenCode tool-result hop: unblock waiting MCP and continue the same Cursor run.
  if (session.pending && session.pump && isToolContinuation(messages)) {
    const results = latestToolResults(messages);
    const payload = contentForPendingTool(session.pending.openAiCall, results);
    if (!payload) throw httpError(400, "Missing tool result for in-flight Cursor run", "missing_tool_result");
    const captureId = session.pending.captureId;
    session.pending.slot.resolveResult(payload);
    session.pending = null;
    captures.delete(captureId);
    touchSession(sessionKey, session);
    return respondFromPump(response, body, session, model, timeout);
  }

  // New user turn (or non-continuation): drop any stale in-flight tool wait.
  await resetInFlight(session);

  const fingerprint = toolsFingerprint(tools);
  const retentionOk = config.retentionOk === true;
  const canDelta = retentionOk
    && session.seeded
    && session.toolFingerprint === fingerprint
    && !isToolContinuation(messages);
  const prompt = canDelta
    ? renderDeltaPrompt(messages, { stripSystemPrompt: config.stripSystemPrompt })
    : renderSeedPrompt(messages, tools, { stripSystemPrompt: config.stripSystemPrompt });

  const captureId = crypto.randomUUID();
  const slot = createPendingToolSlot();
  const openAiCall = openAiToolCall({ name: "__pending__", arguments: {} });
  // openAiCall.id reserved; real name/args filled on capture.
  captures.set(captureId, { slot, openAiCall });

  const mcpServers = tools.length ? {
    client: {
      type: "stdio",
      command: process.execPath,
      args: [forwarderPath],
      env: {
        MODELFERRY_TOOLS: JSON.stringify(tools),
        MODELFERRY_CALLBACK_URL: `http://${config.host}:${config.port}/internal/tool-capture`,
        MODELFERRY_WAIT_URL: `http://${config.host}:${config.port}/internal/tool-wait`,
        MODELFERRY_CALLBACK_TOKEN: callbackToken,
        MODELFERRY_CAPTURE_ID: captureId,
        MODELFERRY_WAIT_TIMEOUT_MS: String(config.requestTimeoutMs)
      }
    }
  } : undefined;

  try {
    const runPromise = session.agent.send(prompt, {
      model: selection,
      ...(mcpServers ? { mcpServers } : {}),
      ...(session.force ? { local: { force: true } } : {}),
      idempotencyKey: crypto.randomUUID()
    });
    const run = await Promise.race([runPromise, abortPromise(timeout)]);
    session.force = false;
    session.pump = createRunPump(run);
    session.activeRun = run;
    session.seeded = true;
    session.toolFingerprint = fingerprint;
    session.captureId = captureId;
    session.slot = slot;
    session.openAiCall = openAiCall;
    touchSession(sessionKey, session);
    return respondFromPump(response, body, session, model, timeout, { captureId, slot, openAiCall });
  } catch (error) {
    captures.delete(captureId);
    throw error;
  }
}

async function respondFromPump(response, body, session, model, timeout, bootstrap = null) {
  const captureId = bootstrap?.captureId || session.captureId;
  const slot = bootstrap?.slot || session.slot;
  const openAiCallTemplate = bootstrap?.openAiCall || session.openAiCall;

  const getCaptured = () => slot?.captured || null;
  const outcome = await waitForToolOrDone(session.pump, getCaptured, { signal: timeout });

  if (outcome.kind === "tool") {
    const tool = outcome.tool;
    const call = openAiToolCall({
      id: openAiCallTemplate?.id,
      name: tool.name,
      arguments: tool.arguments
    });
    // Keep MCP blocked until OpenCode posts the tool result on the next chat request.
    session.pending = {
      slot,
      openAiCall: call,
      captureId,
      name: tool.name,
      arguments: tool.arguments
    };
    captures.set(captureId, { slot, openAiCall: call });
    session.force = false;
    if (body.stream === true) return streamToolResponse(response, model, call, session.activeRun?.id);
    return json(response, 200, completionEnvelope({
      id: `chatcmpl-${session.activeRun?.id || crypto.randomUUID()}`,
      model,
      toolCall: { id: call.id, name: call.function.name, arguments: tool.arguments }
    }));
  }

  // Run finished — clear in-flight bookkeeping.
  captures.delete(captureId);
  session.pending = null;
  session.activeRun = null;
  session.pump = null;
  session.slot = null;
  session.captureId = null;
  if (body.stream === true) return streamTextResponse(response, model, outcome.text, `chatcmpl-${crypto.randomUUID()}`);
  return json(response, 200, completionEnvelope({
    id: `chatcmpl-${crypto.randomUUID()}`,
    model,
    text: outcome.text
  }));
}

function streamToolResponse(response, model, call, runId) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const id = `chatcmpl-${runId || crypto.randomUUID()}`;
  const chunk = (delta, finishReason = null) => response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`);
  chunk({ role: "assistant", content: "" });
  chunk({ tool_calls: [{ index: 0, ...call }] }, "tool_calls");
  response.end("data: [DONE]\n\n");
}

function streamTextResponse(response, model, text, id) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  const chunk = (delta, finishReason = null) => response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }]
  })}\n\n`);
  chunk({ role: "assistant", content: "" });
  if (text) chunk({ content: text });
  chunk({}, "stop");
  response.end("data: [DONE]\n\n");
}

async function resetInFlight(session) {
  if (session.pending?.slot) {
    try { session.pending.slot.rejectResult(new Error("superseded by a new turn")); } catch {}
    captures.delete(session.pending.captureId);
    session.pending = null;
  }
  if (session.activeRun) {
    try { await session.activeRun.cancel(); } catch {}
    session.activeRun = null;
  }
  session.pump = null;
  session.slot = null;
  session.captureId = null;
  session.force = true;
}

async function getSession(key, selection, cwd, parentSession = null) {
  const existing = sessions.get(key);
  if (existing) {
    existing.parentSession = parentSession || existing.parentSession;
    return existing;
  }
  const agent = await Agent.create({
    model: selection,
    name: "OpenCode Model Ferry",
    // OpenCode owns tool execution via MCP; never offer Cursor built-ins.
    tools: ["mcp"],
    local: { cwd, settingSources: [] }
  });
  const session = {
    agent,
    touchedAt: Date.now(),
    force: false,
    seeded: false,
    toolFingerprint: null,
    activeRun: null,
    pump: null,
    pending: null,
    slot: null,
    captureId: null,
    openAiCall: null,
    parentSession
  };
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
    const agentResults = syncInstalledAgentConfigs(nextRegistry, config);
    reportAgentConfigErrors(agentResults);
    catalogState = nextState;
    registry = nextRegistry;
    lastRefreshError = null;
    return { changed: catalogChanged || configResult.changed || agentResults.some((result) => result.changed) };
  } catch (error) {
    lastRefreshError = error.message;
    throw error;
  }
}

function reportAgentConfigErrors(results) {
  for (const result of results) {
    if (result.error) console.error(`Could not update ${result.client}: ${result.error}`);
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
    try {
      if (session.pending?.slot) session.pending.slot.rejectResult(new Error("session evicted"));
      session.agent.close();
    } catch {}
  }
}

function requireLocalAuth(request) {
  if (bearer(request) !== config.localToken) throw httpError(401, "Missing or invalid authorization", "unauthorized");
}

async function requireChatAuth() {
  const auth = await authStatus();
  if (auth.status !== "logged-in") {
    throw httpError(503, `Your Cursor session is not signed in. Log back in from the Model Ferry setup page (http://${config.host}:${config.port}/onboard) or run \`modelferry login\`, then try again.`, "not_authenticated");
  }
  if (needsRenewal(auth, config.loginRenewMs)) {
    try {
      await renewLogin({ signal: AbortSignal.timeout(config.loginTimeoutMs) });
      lastAuthError = null;
      await refreshCatalog();
    } catch (error) {
      throw httpError(503, `Your Cursor session is expiring and the automatic renewal did not finish. Log back in from the Model Ferry setup page (http://${config.host}:${config.port}/onboard) or run \`modelferry login\`, then try again. (${error.message})`, "auth_renewal_failed");
    }
  }
}

function startAuthLogin() {
  if (!authLoginInFlight) {
    authLoginInFlight = performAuthLogin()
      .catch((error) => { lastAuthError = error.message; })
      .finally(() => { authLoginInFlight = null; });
  }
  return authLoginInFlight;
}

async function performAuthLogin() {
  await renewLogin({ signal: AbortSignal.timeout(config.loginTimeoutMs) });
  lastAuthError = null;
  await refreshCatalog();
}

async function maybeRenewAuth() {
  const auth = await authStatus();
  if (!needsRenewal(auth, config.loginRenewMs)) return false;
  await startAuthLogin();
  return true;
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

function html(response, status, body) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function sendError(response, error) {
  if (response.headersSent) return response.end();
  if (error?.code === "not_authenticated" && !/Log back in|modelferry login/i.test(error.message || "")) {
    error = Object.assign(new Error(
      `Your Cursor session is not signed in, or its API key was rejected. Log back in from the Model Ferry setup page (http://${config.host}:${config.port}/onboard) or run \`modelferry login\`, then try again.`
    ), { status: 503, code: "not_authenticated" });
  }
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
    for (const session of sessions.values()) {
      try {
        if (session.pending?.slot) session.pending.slot.rejectResult(new Error("server shutting down"));
        session.agent.close();
      } catch {}
    }
    process.exit(0);
  });
}

if (config.catalogRefreshMs > 0) {
  const refreshTimer = setInterval(async () => {
    try {
      const renewed = await maybeRenewAuth();
      if (!renewed) await refreshCatalog();
    } catch (error) {
      console.error(`Model catalog refresh failed: ${error.message}`);
    }
  }, config.catalogRefreshMs);
  refreshTimer.unref();
}
