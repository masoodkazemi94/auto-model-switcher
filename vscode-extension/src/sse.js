"use strict";

// Robust SSE parsing for the OpenAI-compatible stream returned by FreeRouter.
//
// Handles: CRLF and LF separators, `data:` values split across network chunks,
// UTF-8 sequences split across chunks, multiple `data:` lines per event,
// `[DONE]` markers, comments (lines starting with `:`), and malformed JSON.

const SSE_EVENT_TERMINATORS = ["\n\n", "\r\n\r\n"];

// Split a buffer on SSE event boundaries while keeping partial trailing data.
function splitEvents(buffer) {
  let terminator = "\n\n";
  let index = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf !== -1 && (index === -1 || crlf < index)) {
    terminator = "\r\n\r\n";
    index = crlf;
  }
  if (index === -1) return { events: [], rest: buffer };
  const events = [];
  let start = 0;
  let end = buffer.indexOf(terminator, start);
  while (end !== -1) {
    events.push(buffer.slice(start, end));
    start = end + terminator.length;
    end = buffer.indexOf(terminator, start);
  }
  return { events, rest: buffer.slice(start) };
}

// Parse a single SSE event block into one or more `data:` payloads.
function parseEvent(event) {
  const dataLines = [];
  for (const rawLine of event.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "");
    if (line === "") continue;
    if (line.startsWith(":")) continue; // comment / retry hint
    if (line.startsWith("data:")) {
      let value = line.slice(5);
      if (value.startsWith(" ")) value = value.slice(1);
      dataLines.push(value);
    }
    // field types other than `data:` are ignored by the OpenAI stream.
  }
  return dataLines;
}

// Reads `response.body` and invokes `onData(json)` for each parsed JSON chunk,
// `onDone()` when [DONE] is seen, and `onEventError(error)` for malformed data.
async function readSse(response, handlers) {
  if (!response.body) throw new Error("Router returned no response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = splitEvents(buffer);
    buffer = rest;
    for (const event of events) {
      for (const data of parseEvent(event)) {
        if (!data || data === "[DONE]") {
          if (data === "[DONE]") handlers.onDone?.();
          continue;
        }
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          handlers.onEventError?.(new Error("Malformed SSE JSON payload"));
          continue;
        }
        handlers.onData?.(chunk);
      }
    }
  }
  // Flush any trailing partial event.
  if (buffer.trim()) {
    for (const data of parseEvent(buffer)) {
      if (!data || data === "[DONE]") continue;
      try {
        handlers.onData?.(JSON.parse(data));
      } catch {
        handlers.onEventError?.(new Error("Malformed trailing SSE JSON payload"));
      }
    }
  }
  handlers.onDone?.();
}

module.exports = { readSse, splitEvents, parseEvent };
