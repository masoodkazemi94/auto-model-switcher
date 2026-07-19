"use strict";

// Builds a sanitized diagnostics object for troubleshooting and copying to the
// user. Never includes API keys, proxy credentials, prompts, tool results, or
// conversation content.

const vscode = require("vscode");
const { getEndpoint, getNotificationLevel, getDebugLogging, getDirectSort, getShowTiers, getShowDirectModels } = require("./config");
const { metadataPath, readModelMetadata } = require("./metadata");
const { getChannel, sanitize } = require("./logging");
const { checkHealth } = require("./router-client");

async function collectDiagnostics() {
  const endpoint = getEndpoint();
  const health = endpoint ? await checkHealth() : { online: false, reason: "Invalid endpoint" };
  const metadata = readModelMetadata();
  const eligible = metadata?.availableModels?.length ?? 0;

  const diagnostics = {
    extension: "auto-model-switcher",
    vscodeVersion: vscode.version,
    endpoint: endpoint ?? "(invalid)",
    routerOnline: health.online,
    routerReason: health.online ? undefined : health.reason,
    metadataPath: metadataPath(),
    metadataPresent: Boolean(metadata),
    eligibleModelCount: metadata?.eligibleModelCount ?? eligible,
    updatedAt: metadata?.updatedAt ?? null,
    settings: {
      notificationLevel: getNotificationLevel(),
      debugLogging: getDebugLogging(),
      showTiers: getShowTiers(),
      showDirectModels: getShowDirectModels(),
      directSort: getDirectSort(),
    },
    note: "No API keys, prompts, or conversation contents are included.",
  };
  return diagnostics;
}

function diagnosticsAsText(diagnostics) {
  const lines = ["Auto Model Switcher diagnostics", "=============================="];
  for (const [key, value] of Object.entries(diagnostics)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
  return sanitize(lines.join("\n"));
}

async function copySanitizedDiagnostics() {
  const diagnostics = await collectDiagnostics();
  const text = diagnosticsAsText(diagnostics);
  await vscode.env.clipboard.writeText(text);
  return text;
}

module.exports = { collectDiagnostics, copySanitizedDiagnostics, diagnosticsAsText, getChannel };
