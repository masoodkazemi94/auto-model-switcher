import assert from "node:assert/strict";
import test from "node:test";
import { buildConfig, chooseModels, isEligible, scoreModel } from "../scripts/update-models.mjs";

function model(id, options = {}) {
  return {
    id,
    name: options.name ?? id,
    created: options.created ?? 100,
    context_length: options.context ?? 131_072,
    pricing: { prompt: options.promptPrice ?? "0", completion: options.outputPrice ?? "0" },
    supported_parameters: options.parameters ?? ["tools", "tool_choice", "reasoning"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  };
}

const models = [
  model("vendor/mini-code-8b:free", { created: 120 }),
  model("vendor/coder-80b:free", { created: 100, context: 1_048_576 }),
  model("vendor/reasoning-120b:free", { created: 110 }),
  model("vendor/general-550b-instruct:free", { created: 90 }),
  model("vendor/chat-70b:free", { created: 80 }),
  model("vendor/backup-32b:free", { created: 70 }),
];

test("eligible models must be free and support tool choice", () => {
  assert.equal(isEligible(models[0]), true);
  assert.equal(isEligible(model("paid", { promptPrice: "0.1" })), false);
  assert.equal(isEligible(model("no-tools", { parameters: ["temperature"] })), false);
  assert.equal(isEligible(model("vendor/content-safety:free")), false);
});

test("model selection favors small code models for simple work", () => {
  const selected = chooseModels(models);
  assert.equal(selected.simple.primary.id, "vendor/mini-code-8b:free");
  assert.ok(scoreModel(models[2], "reasoning", 120) > scoreModel(models[0], "reasoning", 120));
});

test("pins override ranking and config uses provider-prefixed ids", () => {
  const selected = chooseModels(models, { simple: "vendor/backup-32b:free" });
  assert.equal(selected.simple.primary.id, "vendor/backup-32b:free");
  const config = buildConfig(selected);
  assert.equal(config.tiers.SIMPLE.primary, "openrouter/vendor/backup-32b:free");
  assert.equal(config.providers.openrouter.auth.key, "OPENROUTER_API_KEY");
});

test("invalid pins fail closed", () => {
  assert.throws(
    () => chooseModels(models, { complex: "vendor/paid-model" }),
    /not currently free/,
  );
});
