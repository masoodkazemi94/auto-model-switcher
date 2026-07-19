"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { classifyHttp } = require("../src/router-client");
const { sanitize } = require("../src/logging");
const { splitEvents, parseEvent } = require("../src/sse");

test("HTTP error classification tags the failing layer and is actionable", () => {
  assert.equal(classifyHttp(401, "local-router").layer, "local-router");
  assert.match(classifyHttp(401, "local-router").message, /Configure/);
  assert.match(classifyHttp(403, "local-router").message, /security policy/);
  assert.match(classifyHttp(429, "local-router").message, /Rate limited/);
  assert.match(classifyHttp(502, "openrouter").message, /Upstream/);
  assert.match(classifyHttp(503, "openrouter").message, /unavailable/);
  assert.match(classifyHttp(500, "openrouter").message, /internal error/);
  assert.match(classifyHttp(404, "local-router").message, /endpoint path/);
  const unknown = classifyHttp(418, "local-router", "teapot");
  assert.match(unknown.message, /418/);
});

test("sanitize removes secrets and credentials from logs", () => {
  const input = "key sk-or-1234567890abcdef and Bearer abc.def.ghi and Authorization: Bearer xyz";
  const output = sanitize(input);
  assert.ok(!output.includes("sk-or-"));
  assert.ok(!output.includes("Bearer abc"));
  assert.ok(!output.includes("xyz"));
  assert.match(output, /REDACTED/);
});

test("sanitize leaves non-secret text intact", () => {
  assert.equal(sanitize("router offline at 127.0.0.1:18800"), "router offline at 127.0.0.1:18800");
});

test("SSE splitEvents handles LF and CRLF and partial trailing data", () => {
  assert.deepEqual(splitEvents("a\n\nb\n\n"), { events: ["a", "b"], rest: "" });
  assert.deepEqual(splitEvents("a\r\n\r\nb\r\n\r\n"), { events: ["a", "b"], rest: "" });
  assert.deepEqual(splitEvents("a\n\npartial"), { events: ["a"], rest: "partial" });
});

test("SSE parseEvent extracts multiple data lines and skips comments", () => {
  assert.deepEqual(parseEvent("data: one\ndata: two"), ["one", "two"]);
  assert.deepEqual(parseEvent(": this is a comment\ndata: x"), ["x"]);
  assert.deepEqual(parseEvent("data: trimmed"), ["trimmed"]);
});
