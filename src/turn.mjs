/**
 * In-flight Cursor run helpers: pump stream events into a queue so OpenCode
 * tool hops can return mid-run without canceling the Agent.
 */

export function createRunPump(run) {
  const state = {
    run,
    queue: [],
    waiters: [],
    text: "",
    done: false,
    error: null,
    result: null
  };

  const pump = (async () => {
    try {
      for await (const event of run.stream()) {
        if (event?.type === "assistant") {
          for (const block of event.message?.content || []) {
            if (block?.type === "text" && typeof block.text === "string") state.text += block.text;
          }
        }
        push(state, { type: "event", event });
      }
      state.result = await run.wait();
      state.done = true;
      push(state, { type: "done", result: state.result });
    } catch (error) {
      state.error = error;
      state.done = true;
      push(state, { type: "error", error });
    }
  })();

  pump.catch(() => {});
  return state;
}

function push(state, item) {
  const waiter = state.waiters.shift();
  if (waiter) waiter.resolve(item);
  else state.queue.push(item);
}

export function nextPumpItem(state, { signal } = {}) {
  if (state.queue.length) return Promise.resolve(state.queue.shift());
  if (state.done && !state.queue.length) {
    if (state.error) return Promise.reject(state.error);
    return Promise.resolve({ type: "done", result: state.result });
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject };
    state.waiters.push(waiter);
    if (!signal) return;
    const onAbort = () => {
      const index = state.waiters.indexOf(waiter);
      if (index >= 0) state.waiters.splice(index, 1);
      reject(Object.assign(new Error("Cursor SDK request timed out"), { status: 504, code: "timeout" }));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wait until a tool is captured or the pumped run finishes.
 * `getCapturedTool` returns the pending outer-client tool or null.
 */
export async function waitForToolOrDone(state, getCapturedTool, { signal } = {}) {
  const textAtStart = state.text;
  for (;;) {
    if (getCapturedTool()) {
      return {
        kind: "tool",
        tool: getCapturedTool(),
        text: state.text.slice(textAtStart)
      };
    }
    const item = await nextPumpItem(state, { signal });
    if (getCapturedTool()) {
      return {
        kind: "tool",
        tool: getCapturedTool(),
        text: state.text.slice(textAtStart)
      };
    }
    if (item.type === "error") throw item.error;
    if (item.type === "done") {
      const result = item.result || state.result;
      if (result?.status === "error") throw new Error(result.result || "Cursor SDK run failed");
      return {
        kind: "done",
        text: state.text.slice(textAtStart) || result?.result || "",
        result
      };
    }
  }
}

export function createPendingToolSlot() {
  let captured = null;
  let resultResolve = null;
  let resultReject = null;
  const resultPromise = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  // Avoid unhandled rejection if the slot is superseded before waiters attach.
  resultPromise.catch(() => {});

  return {
    get captured() {
      return captured;
    },
    capture(tool) {
      if (captured) return false;
      captured = tool;
      return true;
    },
    waitForResult() {
      return resultPromise;
    },
    resolveResult(payload) {
      resultResolve(payload);
    },
    rejectResult(error) {
      resultReject(error);
    }
  };
}

export function contentForPendingTool(pendingTool, toolResults) {
  if (!pendingTool || !toolResults?.length) return null;
  const id = pendingTool.id || pendingTool.openAiCall?.id;
  const name = pendingTool.name
    || pendingTool.function?.name
    || pendingTool.openAiCall?.function?.name;
  const match = toolResults.find((result) => {
    if (id && result.toolCallId && result.toolCallId === id) return true;
    if (name && result.name && result.name === name) return true;
    return false;
  }) || toolResults[toolResults.length - 1];
  return {
    content: match.content,
    isError: false
  };
}
