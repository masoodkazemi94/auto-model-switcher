"use strict";

// Extension commands: status, doctor, refresh, service control, logs, settings,
// favorite management, model browser Quick Pick, and diagnostics copy.

const vscode = require("vscode");
const config = require("./config");
const { log, warn, error: logError, show } = require("./logging");
const { checkHealth } = require("./router-client");
const { readModelMetadata, buildDirectModels, formatTokens, resolveModelLimits, metadataPath } = require("./metadata");
const { filterAndSortDirectModels, isFavorite, daysUntil } = require("./models");
const cli = require("./cli");
const diagnostics = require("./diagnostics");

async function showStatus() {
  const health = await checkHealth();
  if (health.online) {
    const requests = health.stats?.requests ?? 0;
    vscode.window.showInformationMessage(
      `Auto Model Switcher: router online — ${requests} requests handled.`,
    );
  } else {
    const action = await vscode.window.showErrorMessage(
      `Auto Model Switcher: router offline (${health.reason ?? "unknown"}).`,
      "Start router",
    );
    if (action === "Start router") cli.runServiceAction("start");
  }
}

async function showDoctor() {
  const lines = [];
  const endpoint = config.getEndpoint();
  if (!endpoint) lines.push("FAIL  endpoint is invalid or missing");
  else lines.push(`ok    endpoint = ${endpoint}`);
  const health = endpoint ? await checkHealth() : { online: false };
  lines.push(health.online ? "ok    router health check" : `FAIL  router health (${health.reason ?? "offline"})`);
  const metadata = readModelMetadata();
  lines.push(metadata ? `ok    metadata (${metadata.availableModels?.length ?? 0} models)` : "FAIL  metadata missing");
  const text = lines.join("\n");
  show();
  log(text);
  if (lines.some((line) => line.startsWith("FAIL"))) {
    vscode.window.showWarningMessage("Auto Model Switcher: doctor found problems. See Output channel.");
  } else {
    vscode.window.showInformationMessage("Auto Model Switcher: doctor passed.");
  }
}

function refreshModels() {
  cli.runCliCommand("update-models");
}

function startRouter() { cli.runServiceAction("start"); }
function stopRouter() { cli.runServiceAction("stop"); }
function restartRouter() { cli.runServiceAction("restart"); }
function openLogs() { cli.runCliCommand("logs"); }
function configure() { cli.runCliCommand("configure"); }
function openSettings() {
  vscode.commands.executeCommand("workbench.action.openSettings", "@ext:auto-model-switcher.auto-model-switcher");
}

function expirationWarning(expirationDate) {
  const days = daysUntil(expirationDate);
  if (!Number.isFinite(days)) return "";
  if (days < 0) return " · EXPIRED";
  if (days < 7) return ` · expires in ${Math.ceil(days)}d`;
  return "";
}

async function manageFavorites() {
  const metadata = readModelMetadata();
  const direct = filterAndSortDirectModels(buildDirectModels(metadata));
  if (!direct.length) {
    vscode.window.showInformationMessage("No direct free models available to favorite.");
    return;
  }
  const favorites = new Set(config.getFavoriteModels());
  const picks = await vscode.window.showQuickPick(
    direct.map((model) => ({
      label: `${isFavorite(model.id) ? "$(star) " : "$(star-empty) "}${model.name}`,
      description: `${model.provider} · ${formatTokens(model.contextLength)} ctx${expirationWarning(model.expirationDate)}`,
      modelId: model.id.replace(/^openrouter\//, ""),
      picked: favorites.has(model.id) || favorites.has(model.id.replace(/^openrouter\//, "")),
    })),
    { canPickMany: true, placeHolder: "Select favorite direct models (shown first in the picker)" },
  );
  if (!picks) return;
  await config.readConfig().update("favoriteModels", picks.map((pick) => pick.modelId), vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Saved ${picks.length} favorite model(s).`);
}

async function browseModels() {
  const metadata = readModelMetadata();
  const direct = filterAndSortDirectModels(buildDirectModels(metadata));
  const items = direct.map((model) => {
    const limits = resolveModelLimits(model.id, metadata);
    return {
      label: `${model.name}`,
      description: `${model.provider} · ${formatTokens(limits.contextLength)} ctx · ${formatTokens(limits.maxOutputTokens)} out`,
      detail: `Tools: ${limits.toolCalling ? "yes" : "no"} · Image input: ${limits.imageInput ? "yes" : "no"}${expirationWarning(model.expirationDate)}`,
    };
  });
  if (!items.length) {
    vscode.window.showInformationMessage("No direct free models are currently available.");
    return;
  }
  await vscode.window.showQuickPick(items, { placeHolder: "Free direct models" });
}

async function copyDiagnostics() {
  const text = await diagnostics.copySanitizedDiagnostics();
  vscode.window.showInformationMessage("Sanitized diagnostics copied to clipboard.");
  log("Diagnostics copied to clipboard.");
  void text;
}

module.exports = {
  browseModels,
  configure,
  copyDiagnostics,
  manageFavorites,
  openLogs,
  openSettings,
  refreshModels,
  restartRouter,
  showDoctor,
  showStatus,
  startRouter,
  stopRouter,
};
