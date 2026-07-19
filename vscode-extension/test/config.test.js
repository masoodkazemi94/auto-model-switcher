"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const config = require("../src/config");

test("request timeout leaves room for a direct-model fallback", () => {
  assert.equal(config.getRequestTimeoutMs(), 180_000);
});
