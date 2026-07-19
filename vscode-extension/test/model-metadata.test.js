"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDirectModels,
  formatTokens,
  resolveModelLimits,
  normalizeModel,
} = require("../src/metadata");
const { filterAndSortDirectModels, isFilteredOut, daysUntil } = require("../src/models");
const config = require("../src/config");

// Stub a vscode-like configuration object so the filtering/sorting helpers can
// be exercised without launching VS Code.
function withConfig(overrides, fn) {
  const store = {
    get(key, fallback) {
      if (key in overrides) return overrides[key];
      return fallback;
    },
    update() {},
  };
  config.setConfigOverride(store);
  try {
    return fn();
  } finally {
    config.setConfigOverride(null);
  }
}

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
    provider: "unknown",
    imageInput: false,
    toolCalling: true,
    expirationDate: null,
  });
});

test("automatic advertises the smallest active tier limit", () => {
  assert.deepEqual(resolveModelLimits("automatic", metadata), {
    contextLength: 262_000,
    maxOutputTokens: 32_768,
    modelName: "Dynamic tier selection",
    modelId: "auto",
    provider: "auto",
    imageInput: false,
    toolCalling: true,
    expirationDate: null,
  });
});

test("eligible free models become direct picker choices", () => {
  assert.deepEqual(buildDirectModels(metadata), [{
    id: "openrouter/tencent/hy3:free",
    modelId: "tencent/hy3:free",
    name: "Tencent: Hy3 (free)",
    detail: "Direct free model",
    direct: true,
    provider: "tencent",
    contextLength: 262_144,
    maxOutputTokens: 262_144,
    imageInput: false,
    toolCalling: true,
    expirationDate: "2026-07-21",
    role: "direct",
  }]);
  assert.deepEqual(resolveModelLimits("openrouter/tencent/hy3:free", metadata), {
    contextLength: 262_144,
    maxOutputTokens: 262_144,
    modelName: "Tencent: Hy3 (free)",
    modelId: "tencent/hy3:free",
    provider: "tencent",
    imageInput: false,
    toolCalling: true,
    expirationDate: "2026-07-21",
  });
});

test("token counts format for model picker details", () => {
  assert.equal(formatTokens(1_000_000), "1M");
  assert.equal(formatTokens(262_144), "262K");
});

test("old metadata without provider/imageInput/role uses safe defaults", () => {
  const old = { availableModels: [{ id: "acme/old:free", name: "Old", contextLength: 8000, maxOutputTokens: 2000 }] };
  const built = buildDirectModels(old)[0];
  assert.equal(built.provider, "acme");
  assert.equal(built.imageInput, false);
  assert.equal(built.toolCalling, true);
  assert.equal(built.role, "direct");
});

test("invalid context limits fall back to safe defaults", () => {
  const bad = { availableModels: [{ id: "acme/bad:free", name: "Bad", contextLength: "huge", maxOutputTokens: -5 }] };
  const limits = resolveModelLimits("openrouter/acme/bad:free", bad);
  assert.equal(limits.contextLength, 120_000);
  assert.equal(limits.maxOutputTokens, 16_384);
});

test("minimum context window filter hides small models", () => {
  const meta = { availableModels: [
    { id: "small/a:free", name: "Small", contextLength: 32_000 },
    { id: "big/b:free", name: "Big", contextLength: 200_000 },
  ] };
  const direct = buildDirectModels(meta);
  withConfig({ minimumContextWindow: 100_000 }, () => {
    const filtered = filterAndSortDirectModels(direct);
    assert.deepEqual(filtered.map((m) => m.id), ["openrouter/big/b:free"]);
  });
});

test("exclude models and providers filters choices", () => {
  const meta = { availableModels: [
    { id: "keep/a:free", name: "Keep", contextLength: 100_000 },
    { id: "drop/b:free", name: "Drop", contextLength: 100_000 },
    { id: "hidden/c:free", name: "Hidden", contextLength: 100_000, provider: "secret" },
  ] };
  const direct = buildDirectModels(meta);
  withConfig({ excludeModels: ["drop/b:free"], excludeProviders: ["secret"] }, () => {
    const filtered = filterAndSortDirectModels(direct);
    assert.deepEqual(filtered.map((m) => m.id).sort(), ["openrouter/keep/a:free"]);
  });
});

test("include models restricts to the allowlist", () => {
  const meta = { availableModels: [
    { id: "keep/a:free", name: "Keep", contextLength: 100_000 },
    { id: "other/b:free", name: "Other", contextLength: 100_000 },
  ] };
  const direct = buildDirectModels(meta);
  withConfig({ includeModels: ["keep/a:free"] }, () => {
    const filtered = filterAndSortDirectModels(direct);
    assert.deepEqual(filtered.map((m) => m.id), ["openrouter/keep/a:free"]);
  });
});

test("hide expiring within days removes soon-to-expire models", () => {
  const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const meta = { availableModels: [
    { id: "soon/a:free", name: "Soon", contextLength: 100_000, expirationDate: soon },
    { id: "later/b:free", name: "Later", contextLength: 100_000, expirationDate: later },
  ] };
  const direct = buildDirectModels(meta);
  withConfig({ hideExpiringWithinDays: 7 }, () => {
    const filtered = filterAndSortDirectModels(direct);
    assert.deepEqual(filtered.map((m) => m.id), ["openrouter/later/b:free"]);
  });
});

test("favorites sort to the top regardless of sort mode", () => {
  const meta = { availableModels: [
    { id: "zebra/a:free", name: "Zebra", contextLength: 100_000 },
    { id: "alpha/b:free", name: "Alpha", contextLength: 100_000 },
  ] };
  const direct = buildDirectModels(meta);
  withConfig({ favoriteModels: ["alpha/b:free"], directSort: "name" }, () => {
    const sorted = filterAndSortDirectModels(direct);
    assert.equal(sorted[0].id, "openrouter/alpha/b:free");
  });
});

test("direct sort by context orders descending", () => {
  const meta = { availableModels: [
    { id: "small/a:free", name: "Small", contextLength: 32_000 },
    { id: "big/b:free", name: "Big", contextLength: 200_000 },
  ] };
  const direct = buildDirectModels(meta);
  withConfig({ directSort: "context" }, () => {
    const sorted = filterAndSortDirectModels(direct);
    assert.deepEqual(sorted.map((m) => m.id), ["openrouter/big/b:free", "openrouter/small/a:free"]);
  });
});

test("daysUntil handles missing and past dates", () => {
  assert.equal(daysUntil(null), Infinity);
  assert.equal(daysUntil("not-a-date"), Infinity);
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.ok(daysUntil(past) < 0);
});

test("isFilteredOut ignores routing tiers", () => {
  withConfig({ minimumContextWindow: 1_000_000 }, () => {
    assert.equal(isFilteredOut({ direct: false, id: "tier/medium" }), false);
    assert.equal(isFilteredOut({ direct: true, id: "openrouter/tiny:free", contextLength: 1000 }), true);
  });
});

test("normalizeModel derives provider from id", () => {
  const normalized = normalizeModel({ id: "google/gemini:free", name: "Gem" });
  assert.equal(normalized.provider, "google");
  assert.equal(normalized.toolCalling, true);
});
