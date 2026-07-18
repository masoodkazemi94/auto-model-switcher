"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_CONTEXT = 120_000;
const DEFAULT_OUTPUT = 16_384;
const TIER_IDS = ["simple", "medium", "complex", "reasoning"];

function metadataPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "auto-model-switcher", "models.json");
}

function readModelMetadata(filePath = metadataPath()) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function validLimit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function tierLimits(tier, metadata) {
  const entry = metadata?.tiers?.[tier];
  return {
    contextLength: validLimit(entry?.contextLength, DEFAULT_CONTEXT),
    maxOutputTokens: validLimit(entry?.maxOutputTokens, DEFAULT_OUTPUT),
    modelName: entry?.primaryName || entry?.primary || null,
    modelId: entry?.primary || null,
  };
}

function resolveModelLimits(modelId, metadata) {
  if (modelId === "automatic" || modelId === "auto") {
    const limits = TIER_IDS.map((tier) => tierLimits(tier, metadata));
    return {
      contextLength: Math.min(...limits.map((item) => item.contextLength)),
      maxOutputTokens: Math.min(...limits.map((item) => item.maxOutputTokens)),
      modelName: "Dynamic tier selection",
      modelId: "auto",
      expirationDate: null,
    };
  }
  if (modelId.startsWith("openrouter/")) {
    const directId = modelId.slice("openrouter/".length);
    const entry = metadata?.availableModels?.find((model) => model.id === directId);
    return {
      contextLength: validLimit(entry?.contextLength, DEFAULT_CONTEXT),
      maxOutputTokens: validLimit(entry?.maxOutputTokens, DEFAULT_OUTPUT),
      modelName: entry?.name || directId,
      modelId: entry?.id || directId,
      expirationDate: entry?.expirationDate ?? null,
    };
  }
  const tier = modelId.startsWith("tier/") ? modelId.slice(5) : "medium";
  return tierLimits(tier, metadata);
}

function buildDirectModels(metadata) {
  return (metadata?.availableModels ?? []).map((model) => ({
    id: `openrouter/${model.id}`,
    name: model.name,
    detail: "Direct free model",
    direct: true,
  }));
}

function formatTokens(value) {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

module.exports = {
  buildDirectModels,
  formatTokens,
  metadataPath,
  readModelMetadata,
  resolveModelLimits,
};
