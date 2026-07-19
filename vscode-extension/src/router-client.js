"use strict";

// Local FreeRouter client. Communicates only with the configured local router
// endpoint. Adds connection/request timeouts, classifies HTTP errors with the
// failing layer, and never surfaces secrets or conversation content.

const { log, debug, warn, error: logError } = require("./logging");
const { getEndpoint, getConnectionTimeoutMs, getRequestTimeoutMs } = require("./config");
const { readSse } = require("./sse");

class RouterError extends Error {
  constructor(message, { layer, status, cause } = {}) {
    super(message);
    this.name = "RouterError";
    this.layer = layer ?? "vscode-extension";
    this.status = status ?? null;
    if (cause) this.cause = cause;
  }
}

// Classify a non-OK HTTP response into an actionable, layer-tagged error.
function classifyHttp(status, layer, detailText) {
  const safeDetail = (detailText ?? "").slice(0, 300);
  switch (status) {
    case 401:
      return new RouterError(
        "OpenRouter key missing or revoked. Run 'Auto Model Switcher: Configure'.",
        { layer, status },
      );
    case 403:
      return new RouterError(
        "Access denied by OpenRouter security policy. The router may be missing proxy settings.",
        { layer, status },
      );
    case 404:
      return new RouterError(
        "Router endpoint path not found. Check the configured endpoint and router version.",
        { layer, status },
      );
    case 429:
      return new RouterError(
        "Rate limited by OpenRouter. Free models have tight limits; retry shortly.",
        { layer, status },
      );
    case 500:
      return new RouterError("OpenRouter returned an internal error. Retry later.", { layer, status });
    case 502:
      return new RouterError(
        "Upstream failure (502). The model provider or OpenRouter is unreachable.",
        { layer, status },
      );
    case 503:
      return new RouterError(
        "Service unavailable (503). The model provider may be overloaded; retry later.",
        { layer, status },
      );
    default:
      return new RouterError(`Request failed (HTTP ${status}). ${safeDetail}`, { layer, status });
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  const endpoint = getEndpoint();
  if (!endpoint) {
    return { online: false, reason: "Invalid endpoint configured" };
  }
  try {
    const response = await fetchWithTimeout(
      `${endpoint}/health`,
      { method: "GET" },
      getConnectionTimeoutMs(),
    );
    if (!response.ok) {
      return { online: false, reason: `Health check returned HTTP ${response.status}` };
    }
    const body = await response.json().catch(() => ({}));
    return { online: true, stats: body?.stats ?? null };
  } catch (err) {
    if (err?.message === "timeout") {
      return { online: false, reason: "Health check timed out" };
    }
    if (err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED") {
      return { online: false, reason: "Connection refused (router offline?)" };
    }
    return { online: false, reason: err.message };
  }
}

// Request a streaming chat completion. `onText` / `onToolCall` surface partial
// results. Throws a RouterError on failure, cancellation, or malformed stream.
async function requestChatCompletion(options) {
  const endpoint = options.endpoint || getEndpoint();
  if (!endpoint) {
    throw new RouterError("Invalid or missing router endpoint.", { layer: "vscode-extension" });
  }

  const body = {
    model: options.model,
    messages: options.messages,
    stream: true,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice;
  }

  let response;
  try {
    response = await fetchWithTimeout(
      `${endpoint}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      getRequestTimeoutMs(),
    );
  } catch (err) {
    if (err?.message === "timeout") {
      throw new RouterError("Request timed out talking to the local router.", { layer: "local-router" });
    }
    if (err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED") {
      throw new RouterError("Local router is offline (connection refused).", { layer: "local-router" });
    }
    if (err?.name === "AbortError") {
      throw err; // cancellation, propagated as-is
    }
    throw new RouterError(`Could not reach the local router: ${err.message}`, { layer: "local-router" });
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    const classified = classifyHttp(response.status, "local-router", details);
    logError(`Router HTTP ${response.status}: ${details.slice(0, 200)}`);
    throw classified;
  }

  if (!response.body) {
    throw new RouterError("Router returned an empty response body.", { layer: "local-router" });
  }

  const pendingCalls = new Map();
  await readSse(response, {
    onData: (chunk) => {
      if (chunk.error) {
        // OpenAI-style streamed error event.
        throw new RouterError(chunk.error.message ?? "Router stream failed", { layer: "openrouter" });
      }
      const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
      const delta = choice?.delta ?? {};
      if (typeof delta.content === "string" && delta.content) options.onText?.(delta.content);
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const pending = pendingCalls.get(index) ?? { id: "", name: "", arguments: "" };
        if (call.id) pending.id = call.id;
        if (call.function?.name) pending.name = call.function.name;
        if (call.function?.arguments) pending.arguments += call.function.arguments;
        pendingCalls.set(index, pending);
      }
    },
    onEventError: (err) => {
      warn(`Ignoring malformed SSE event: ${err.message}`);
    },
    onDone: () => {},
  });

  // Emit all completed tool calls (single or multiple) with safe argument parsing.
  for (const call of [...pendingCalls.values()]) {
    let input = {};
    try {
      input = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      input = { raw: call.arguments };
      warn("Tool call had invalid JSON arguments; passing raw string.");
    }
    options.onToolCall?.({ id: call.id, name: call.name, input });
  }
}

module.exports = { RouterError, checkHealth, requestChatCompletion, classifyHttp };
