"use strict";

// Conversion between VS Code chat messages and OpenAI-compatible messages, plus
// a thin re-export of the router client's SSE reader. Kept small so the
// provider stays focused on LM-chat concerns.

const { readSse } = require("./sse");

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

module.exports = { readSse, toOpenAIMessages };
