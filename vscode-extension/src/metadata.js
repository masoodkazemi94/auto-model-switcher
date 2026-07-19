"use strict";

// Reads and caches the generated model metadata produced by
// `scripts/update-models.mjs`. The schema is extended with optional fields
// (provider, imageInput, toolCalling, role) but remains backward compatible:
// any missing field falls back to a safe default so old metadata files keep
// working.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { log, debug, warn } = require("./logging");

const DEFAULT_CONTEXT = 120_000;
const DEFAULT_OUTPUT = 16_384;
const TIER_IDS = ["simple", "medium", "complex", "reasoning"];

let cache = { value: null, path: null, mtime: 0 };

function metadataPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "auto-model-switcher", "models.json");
}

function readModelMetadata(filePath = metadataPath()) {
  if (cache.path === filePath && cache.value && cache.mtime === safeMtime(filePath)) {
    return cache.value;
  }
  let parsed = null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    if (filePath === cache.path) {
      // Keep last good metadata if the file is temporarily missing/malformed.
      if (cache.value) {
        warn(`Metadata at ${filePath} is unreadable (${error.message}); using cached copy.`);
        return cache.value;
      }
    }
    log(`Metadata unavailable at ${filePath}: ${error.message}`);
    return null;
  }
  cache = { value: parsed, path: filePath, mtime: safeMtime(filePath) };
  return parsed;
}

function safeMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function validLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeModel(entry) {
  return {
    id: entry.id,
    name: entry.name || entry.id,
    contextLength: validLimit(entry.contextLength, DEFAULT_CONTEXT),
    maxOutputTokens: validLimit(entry.maxOutputTokens, DEFAULT_OUTPUT),
    provider: typeof entry.provider === "string" ? entry.provider : (entry.id?.split("/")[0] ?? "unknown"),
    imageInput: bool(entry.imageInput, false),
    toolCalling: bool(entry.toolCalling, true),
    expirationDate: entry.expirationDate ?? null,
    role: entry.role ?? "direct",
  };
}

function tierLimits(tier, metadata) {
  const entry = metadata?.tiers?.[tier];
  return {
    contextLength: validLimit(entry?.contextLength, DEFAULT_CONTEXT),
    maxOutputTokens: validLimit(entry?.maxOutputTokens, DEFAULT_OUTPUT),
    modelName: entry?.primaryName || entry?.primary || null,
    modelId: entry?.primary || null,
    provider: entry?.primary ? (entry.primary.split("/")[0] ?? "unknown") : "unknown",
    imageInput: bool(entry?.imageInput, false),
    toolCalling: bool(entry?.toolCalling, true),
    expirationDate: null,
  };
}

// Resolve the advertised limits for a model id. Never advertises a limit larger
// than the selected backend can safely handle: direct models use their own
// metadata, tiers use their current primary, and Automatic uses the smallest
// active tier limit.
function resolveModelLimits(modelId, metadata) {
  if (modelId === "automatic" || modelId === "auto") {
    const limits = TIER_IDS.map((tier) => tierLimits(tier, metadata));
    return {
      contextLength: Math.min(...limits.map((item) => item.contextLength)),
      maxOutputTokens: Math.min(...limits.map((item) => item.maxOutputTokens)),
      modelName: "Dynamic tier selection",
      modelId: "auto",
      provider: "auto",
      imageInput: false,
      toolCalling: true,
      expirationDate: null,
    };
  }
  if (modelId.startsWith("openrouter/")) {
    const directId = modelId.slice("openrouter/".length);
    const entry = metadata?.availableModels?.find((model) => model.id === directId);
    const normalized = normalizeModel(entry ?? { id: directId });
    return {
      contextLength: normalized.contextLength,
      maxOutputTokens: normalized.maxOutputTokens,
      modelName: normalized.name,
      modelId: normalized.id,
      provider: normalized.provider,
      imageInput: normalized.imageInput,
      toolCalling: normalized.toolCalling,
      expirationDate: normalized.expirationDate,
    };
  }
  const tier = modelId.startsWith("tier/") ? modelId.slice(5) : "medium";
  return tierLimits(tier, metadata);
}

function buildDirectModels(metadata) {
  const models = metadata?.availableModels ?? [];
  return models.map((entry) => {
    const normalized = normalizeModel(entry);
    return {
      id: `openrouter/${normalized.id}`,
      modelId: normalized.id,
      name: normalized.name,
      detail: "Direct free model",
      direct: true,
      provider: normalized.provider,
      contextLength: normalized.contextLength,
      maxOutputTokens: normalized.maxOutputTokens,
      imageInput: normalized.imageInput,
      toolCalling: normalized.toolCalling,
      expirationDate: normalized.expirationDate,
      role: normalized.role,
    };
  });
}

function formatTokens(value) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

// Invalidate the cached metadata. Used by the debounced watcher.
function invalidateCache() {
  cache = { value: null, path: null, mtime: 0 };
  debug("Metadata cache invalidated");
}

module.exports = {
  buildDirectModels,
  formatTokens,
  invalidateCache,
  metadataPath,
  normalizeModel,
  readModelMetadata,
  resolveModelLimits,
};
