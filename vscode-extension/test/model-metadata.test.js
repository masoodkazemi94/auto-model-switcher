"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { formatTokens, resolveModelLimits } = require("../src/model-metadata");

const metadata = {
  tiers: {
    simple: { contextLength: 262_144, maxOutputTokens: 32_768, primaryName: "Fast Model" },
    medium: { contextLength: 262_000, maxOutputTokens: 262_000, primaryName: "Coder" },
    complex: { contextLength: 1_000_000, maxOutputTokens: 65_536, primaryName: "Nemotron" },
    reasoning: { contextLength: 1_000_000, maxOutputTokens: 65_536, primaryName: "Nemotron" },
  },
};

test("tier limits follow selected model metadata", () => {
  assert.deepEqual(resolveModelLimits("tier/complex", metadata), {
    contextLength: 1_000_000,
    maxOutputTokens: 65_536,
    modelName: "Nemotron",
    modelId: null,
  });
});

test("auto advertises the smallest active tier limit", () => {
  assert.deepEqual(resolveModelLimits("auto", metadata), {
    contextLength: 262_000,
    maxOutputTokens: 32_768,
    modelName: "Dynamic tier selection",
    modelId: "auto",
  });
});

test("token counts format for model picker details", () => {
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(262_144), "262K");
});
