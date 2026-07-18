"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { readSse, toOpenAIMessages } = require("../src/openai");

class TextPart { constructor(value) { this.value = value; } }
class ToolCallPart {
  constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; }
}
class ToolResultPart {
  constructor(callId, content) { this.callId = callId; this.content = content; }
}
const fakeVscode = {
  LanguageModelTextPart: TextPart,
  LanguageModelToolCallPart: ToolCallPart,
  LanguageModelToolResultPart: ToolResultPart,
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
};

test("converts text, tool calls, and tool results", () => {
  const converted = toOpenAIMessages([
    { role: 1, content: [new TextPart("Fix it")] },
    { role: 2, content: [new TextPart("Checking"), new ToolCallPart("c1", "read_file", { path: "a" })] },
    { role: 1, content: [new ToolResultPart("c1", [new TextPart("contents")])] },
  ], fakeVscode);

  assert.deepEqual(converted, [
    { role: "user", content: "Fix it" },
    {
      role: "assistant",
      content: "Checking",
      tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a"}' } }],
    },
    { role: "tool", tool_call_id: "c1", content: "contents" },
  ]);
});

test("SSE reader handles chunks split across byte boundaries", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"one":'));
      controller.enqueue(encoder.encode('1}\n\ndata: [DONE]\n\n'));
      controller.close();
    },
  });
  const events = [];
  await readSse({ body: stream }, (event) => events.push(event));
  assert.deepEqual(events, ['data: {"one":1}', "data: [DONE]"]);
});
