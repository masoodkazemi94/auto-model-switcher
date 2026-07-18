"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildDirectModels, formatTokens, resolveModelLimits } = require("../src/model-metadata");

const metadata = {
  tiers: {
    simple: { contextLength: 262_144, maxOutputTokens: 32_768, primaryName: "Fast Model" },
    medium: { contextLength: 262_000, maxOutputTokens: 262_000, primaryName: "Coder" },
    complex: { contextLength: 1_000_000, maxOutputTokens: 65_536, primaryName: "Nemotron" },
    reasoning: { contextLength: 1_000_000, maxOutputTokens: 65_536, primaryName: "Nemotron" },
  },
  availableModels: [{
    id: "tencent/hy3:free",
    name: "Tencent: Hy3 (free)",
    contextLength: 262_144,
    maxOutputTokens: 262_144,
    expirationDate: "2026-07-21",
  }],
};

test("tier limits follow selected model metadata", () => {
  assert.deepEqual(resolveModelLimits("tier/complex", metadata), {
    contextLength: 1_000_000,
    maxOutputTokens: 65_536,
    modelName: "Nemotron",
    modelId: null,
  });
});

test("automatic advertises the smallest active tier limit", () => {
  assert.deepEqual(resolveModelLimits("automatic", metadata), {
    contextLength: 262_000,
    maxOutputTokens: 32_768,
    modelName: "Dynamic tier selection",
    modelId: "auto",
    expirationDate: null,
  });
});

test("eligible free models become direct picker choices", () => {
  assert.deepEqual(buildDirectModels(metadata), [{
    id: "openrouter/tencent/hy3:free",
    name: "Tencent: Hy3 (free)",
    detail: "Direct free model",
    direct: true,
  }]);
  assert.deepEqual(resolveModelLimits("openrouter/tencent/hy3:free", metadata), {
    contextLength: 262_144,
    maxOutputTokens: 262_144,
    modelName: "Tencent: Hy3 (free)",
    modelId: "tencent/hy3:free",
    expirationDate: "2026-07-21",
  });
});

test("token counts format for model picker details", () => {
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(262_144), "262K");
});
