#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const TIERS = ["simple", "medium", "complex", "reasoning"];
const BLOCKED_NAME_PARTS = ["safety", "moderation", "embedding", "guard"];
const execFileAsync = promisify(execFile);

function numericSize(model) {
  const text = `${model.id} ${model.name}`.toLowerCase();
  const matches = [...text.matchAll(/(?:^|[^0-9])([0-9]+(?:\.[0-9]+)?)b(?:[^a-z]|$)/g)];
  return matches.length ? Math.max(...matches.map((match) => Number(match[1]))) : 0;
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

export function isEligible(model) {
  const pricing = model.pricing ?? {};
  const parameters = model.supported_parameters ?? [];
  const architecture = model.architecture ?? {};
  const input = architecture.input_modalities ?? [];
  const output = architecture.output_modalities ?? [];
  const text = `${model.id} ${model.name ?? ""}`.toLowerCase();

  return pricing.prompt === "0"
    && pricing.completion === "0"
    && parameters.includes("tools")
    && parameters.includes("tool_choice")
    && input.includes("text")
    && output.includes("text")
    && Number(model.context_length ?? 0) >= 32_768
    && model.id !== "openrouter/free"
    && !includesAny(text, BLOCKED_NAME_PARTS);
}

export function scoreModel(model, tier, newestCreated) {
  const text = `${model.id} ${model.name ?? ""}`.toLowerCase();
  const parameters = model.supported_parameters ?? [];
  const context = Number(model.context_length ?? 0);
  const size = numericSize(model);
  const recency = newestCreated > 0 ? Number(model.created ?? 0) / newestCreated : 0;
  const contextScore = Math.min(Math.log2(Math.max(context, 32_768) / 32_768), 5);
  const code = includesAny(text, ["code", "coder", "poolside", "devstral"]);
  const reasoning = includesAny(text, ["reason", "thinking", "nemotron", "qwq", "r1"])
    || parameters.includes("reasoning");
  const instruct = includesAny(text, ["instruct", "chat", "-it", " it "]);

  const common = (recency * 15) + (contextScore * 3) + (instruct ? 3 : 0);
  switch (tier) {
    case "simple":
      return common + (code ? 30 : 0)
        - (Math.log2(Math.max(size, 1)) * 3)
        - (size > 100 ? 15 : 0);
    case "medium":
      return common + (code ? 36 : 0) + Math.min(size, 120) / 2 + (reasoning ? 5 : 0);
    case "complex":
      return common + (code ? 18 : 0) + Math.min(size, 600) / 3 + (reasoning ? 12 : 0);
    case "reasoning":
      return common + (reasoning ? 60 : 0) + Math.min(size, 600) / 4 + (code ? 8 : 0);
    default:
      throw new Error(`Unknown tier: ${tier}`);
  }
}

export function chooseModels(models, pins = {}) {
  const eligible = models.filter(isEligible);
  if (eligible.length < 4) {
    throw new Error(`Only ${eligible.length} free tool-calling models are available; need at least 4`);
  }

  const byId = new Map(eligible.map((model) => [model.id, model]));
  const newest = Math.max(...eligible.map((model) => Number(model.created ?? 0)), 1);
  const selected = {};
  for (const tier of TIERS) {
    const ranked = [...eligible].sort((a, b) => {
      const difference = scoreModel(b, tier, newest) - scoreModel(a, tier, newest);
      return difference || a.id.localeCompare(b.id);
    });
    const pinned = pins[tier];
    if (pinned && !byId.has(pinned)) {
      throw new Error(`Pinned ${tier} model is not currently free and tool-capable: ${pinned}`);
    }
    const primary = pinned
      ? byId.get(pinned)
      : ranked[0];
    const fallback = ranked.filter((model) => model.id !== primary.id).slice(0, 4);
    selected[tier] = { primary, fallback };
  }
  return selected;
}

function routedId(model) {
  return `openrouter/${model.id}`;
}

export function buildConfig(selected) {
  const tierConfig = {};
  for (const tier of TIERS) {
    tierConfig[tier.toUpperCase()] = {
      primary: routedId(selected[tier].primary),
      fallback: selected[tier].fallback.map(routedId),
    };
  }
  return {
    port: 18800,
    host: "127.0.0.1",
    providers: {
      openrouter: {
        baseUrl: "https://openrouter.ai/api/v1",
        api: "openai",
        headers: {
          "HTTP-Referer": "https://github.com/auto-model-switcher/auto-model-switcher",
          "X-OpenRouter-Title": "Auto Model Switcher",
        },
        auth: { type: "env", key: "OPENROUTER_API_KEY" },
      },
    },
    tiers: tierConfig,
    agenticTiers: tierConfig,
    auth: { default: "environment" },
  };
}

export function getModelLimits(model) {
  const catalogContext = Number(model.context_length ?? 0);
  const providerContext = Number(model.top_provider?.context_length ?? 0);
  const contextLength = providerContext > 0
    ? Math.min(catalogContext || providerContext, providerContext)
    : catalogContext;
  const providerOutput = Number(model.top_provider?.max_completion_tokens ?? 0);
  const maxOutputTokens = providerOutput > 0
    ? Math.min(providerOutput, contextLength)
    : Math.min(16_384, contextLength);
  return { contextLength, maxOutputTokens };
}

export function buildMetadata(selected, eligible, pins) {
  const tiers = {};
  for (const tier of TIERS) {
    const limits = getModelLimits(selected[tier].primary);
    tiers[tier] = {
      primary: selected[tier].primary.id,
      primaryName: selected[tier].primary.name,
      contextLength: limits.contextLength,
      maxOutputTokens: limits.maxOutputTokens,
      fallbacks: selected[tier].fallback.map((model) => model.id),
      pinned: pins[tier] === selected[tier].primary.id,
    };
  }
  return {
    updatedAt: new Date().toISOString(),
    source: MODELS_URL,
    eligibleModelCount: eligible.length,
    tiers,
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(path, value) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function parseArguments(args) {
  const result = {
    configDir: process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, "auto-model-switcher")
      : join(homedir(), ".config", "auto-model-switcher"),
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--config-dir") result.configDir = args[++index];
    else if (args[index] === "--models-file") result.modelsFile = args[++index];
    else if (args[index] === "--pin") result.pin = [args[++index], args[++index]];
    else if (args[index] === "--unpin") result.unpin = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  await mkdir(options.configDir, { recursive: true, mode: 0o700 });
  const pinsPath = join(options.configDir, "pins.json");
  const pins = await readJson(pinsPath, {});

  if (options.pin) {
    const [tier, model] = options.pin;
    if (!TIERS.includes(tier.toLowerCase())) throw new Error(`Unknown tier: ${tier}`);
    pins[tier.toLowerCase()] = model;
  }
  if (options.unpin) {
    if (!TIERS.includes(options.unpin.toLowerCase())) throw new Error(`Unknown tier: ${options.unpin}`);
    delete pins[options.unpin.toLowerCase()];
  }

  let payload;
  if (options.modelsFile) {
    payload = await readJson(options.modelsFile, null);
  } else {
    try {
      const { stdout } = await execFileAsync(
        "curl",
        ["-fsSL", "--retry", "3", "--connect-timeout", "15", MODELS_URL],
        { maxBuffer: 50 * 1024 * 1024 },
      );
      payload = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`OpenRouter models request failed: ${error.message}`);
    }
  }
  const models = payload?.data;
  if (!Array.isArray(models)) throw new Error("OpenRouter response has no model list");
  const eligible = models.filter(isEligible);
  const selected = chooseModels(models, pins);

  await atomicJson(join(options.configDir, "freerouter.config.json"), buildConfig(selected));
  await atomicJson(join(options.configDir, "models.json"), buildMetadata(selected, eligible, pins));
  await atomicJson(pinsPath, pins);

  for (const tier of TIERS) {
    console.log(`${tier.padEnd(9)} ${selected[tier].primary.id}${pins[tier] ? " (pinned)" : ""}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[auto-model-switcher] ${error.message}`);
    process.exitCode = 1;
  });
}
