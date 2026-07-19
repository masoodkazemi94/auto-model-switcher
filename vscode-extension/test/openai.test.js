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
  const chunks = [];
  await readSse({ body: stream }, { onData: (data) => chunks.push(data) });
  assert.deepEqual(chunks, [{ one: 1 }]);
});

test("SSE reader handles CRLF separators", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: {\"a\":1}\r\n\r\ndata: {\"b\":2}\r\n\r\n"));
      controller.close();
    },
  });
  const chunks = [];
  await readSse({ body: stream }, { onData: (data) => chunks.push(data) });
  assert.deepEqual(chunks, [{ a: 1 }, { b: 2 }]);
});

test("SSE reader handles multiple data lines in one event", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: {\"a\":1}\ndata: {\"b\":2}\n\n"));
      controller.close();
    },
  });
  const chunks = [];
  await readSse({ body: stream }, { onData: (data) => chunks.push(data) });
  assert.deepEqual(chunks, [{ a: 1 }, { b: 2 }]);
});

test("SSE reader handles UTF-8 split across chunks", async () => {
  const encoder = new TextEncoder();
  const text = "data: {\"name\":\"café\"}\n\n";
  const bytes = encoder.encode(text);
  const stream = new ReadableStream({
    start(controller) {
      // Split the multi-byte character boundary.
      controller.enqueue(bytes.subarray(0, 18));
      controller.enqueue(bytes.subarray(18));
      controller.close();
    },
  });
  const chunks = [];
  await readSse({ body: stream }, { onData: (data) => chunks.push(data) });
  assert.deepEqual(chunks, [{ name: "café" }]);
});

test("SSE reader ignores malformed JSON", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: {not json}\n\ndata: {\"ok\":true}\n\n"));
      controller.close();
    },
  });
  const chunks = [];
  let errored = 0;
  await readSse({ body: stream }, { onData: (data) => chunks.push(data), onEventError: () => { errored += 1; } });
  assert.deepEqual(chunks, [{ ok: true }]);
  assert.equal(errored, 1);
});

test("SSE reader reassembles partial streamed tool calls", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const first = JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"path":' } }] } }],
      });
      const arg2 = '"a"}';
      const second = JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: arg2 } }] } }],
      });
      controller.enqueue(encoder.encode(`data: ${first}\n\n`));
      controller.enqueue(encoder.encode(`data: ${second}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  // Exercise the full SSE parsing path used by the router client.
  const { readSse: readSseFromSse } = require("../src/sse");
  const pendingCalls = new Map();
  await readSseFromSse({ body: stream }, {
    onData: (chunk) => {
      for (const call of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const pending = pendingCalls.get(index) ?? { id: "", name: "", arguments: "" };
        if (call.id) pending.id = call.id;
        if (call.function?.name) pending.name = call.function.name;
        if (call.function?.arguments) pending.arguments += call.function.arguments;
        pendingCalls.set(index, pending);
      }
    },
  });
  const call = [...pendingCalls.values()][0];
  assert.equal(call.name, "read_file");
  assert.deepEqual(JSON.parse(call.arguments), { path: "a" });
});
