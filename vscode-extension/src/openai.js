"use strict";

function textFromParts(parts, vscode) {
  return parts
    .filter((part) => part instanceof vscode.LanguageModelTextPart)
    .map((part) => part.value)
    .join("");
}

function toOpenAIMessages(messages, vscode) {
  const result = [];
  for (const message of messages) {
    const text = textFromParts(message.content, vscode);
    const isAssistant = message.role === vscode.LanguageModelChatMessageRole.Assistant;
    if (isAssistant) {
      const calls = message.content
        .filter((part) => part instanceof vscode.LanguageModelToolCallPart)
        .map((part) => ({
          id: part.callId,
          type: "function",
          function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
        }));
      const converted = { role: "assistant", content: text || null };
      if (calls.length) converted.tool_calls = calls;
      result.push(converted);
      continue;
    }

    if (text) result.push({ role: "user", content: text });
    const toolResults = message.content.filter(
      (part) => part instanceof vscode.LanguageModelToolResultPart,
    );
    for (const part of toolResults) {
      result.push({
        role: "tool",
        tool_call_id: part.callId,
        content: textFromParts(part.content, vscode) || JSON.stringify(part.content),
      });
    }
    if (!text && !toolResults.length) result.push({ role: "user", content: "" });
  }
  return result;
}

async function readSse(response, handlers) {
  if (!response.body) throw new Error("Router returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) handlers(event);
  }
  if (buffer.trim()) handlers(buffer);
}

async function requestChatCompletion(options) {
  const body = {
    model: options.model,
    messages: options.messages,
    stream: true,
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice;
  }

  const response = await fetch(`${options.endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Router request failed (HTTP ${response.status}): ${details.slice(0, 500)}`);
  }

  const pendingCalls = new Map();
  await readSse(response, (event) => {
    for (const line of event.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(chunk.error.message ?? "Router stream failed");
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === "string" && delta.content) options.onText(delta.content);
      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const pending = pendingCalls.get(index) ?? { id: "", name: "", arguments: "" };
        if (call.id) pending.id = call.id;
        if (call.function?.name) pending.name = call.function.name;
        if (call.function?.arguments) pending.arguments += call.function.arguments;
        pendingCalls.set(index, pending);
      }
    }
  });

  for (const call of [...pendingCalls.values()]) {
    let input = {};
    try {
      input = JSON.parse(call.arguments || "{}");
    } catch {
      input = { raw: call.arguments };
    }
    options.onToolCall({ id: call.id, name: call.name, input });
  }
}

module.exports = { readSse, requestChatCompletion, toOpenAIMessages };
