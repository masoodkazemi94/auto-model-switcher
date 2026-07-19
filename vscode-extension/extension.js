"use strict";

const vscode = require("vscode");
const { toOpenAIMessages } = require("./src/openai");
const metadata = require("./src/metadata");
const router = require("./src/router-client");
const config = require("./src/config");
const { StatusBar } = require("./src/statusbar");
const commands = require("./src/commands");
const { filterAndSortDirectModels, isFavorite } = require("./src/models");
const { log, debug, warn, error: logError, show } = require("./src/logging");

const ROUTING_MODELS = [
  { id: "automatic", name: "Automatic", detail: "Automatic task routing" },
  { id: "tier/simple", name: "Fast", detail: "Quick and lightweight" },
  { id: "tier/medium", name: "Balanced", detail: "Coding and daily work" },
  { id: "tier/complex", name: "Complex", detail: "Large or difficult changes" },
  { id: "tier/reasoning", name: "Reasoning", detail: "Deep analysis" },
];

class AutoModelProvider {
  constructor(statusBar) {
    this.statusBar = statusBar;
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
    this._wireWatcher();
  }

  _wireWatcher() {
    this.metadataWatcher = null;
    if (!config.getAutoRefresh()) return;
    try {
      const dir = require("node:path").dirname(metadata.metadataPath());
      let debounce;
      this.metadataWatcher = require("node:fs").watch(dir, (_event, filename) => {
        if (!filename || filename.toString() === "models.json") {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            metadata.invalidateCache();
            this.changeEmitter.fire();
            debug("Metadata change detected; model list refreshed.");
          }, 300);
        }
      });
    } catch (error) {
      warn(`Metadata watcher could not be started: ${error.message}`);
      this.metadataWatcher = null;
    }
  }

  async provideLanguageModelChatInformation() {
    const metadataObject = metadata.readModelMetadata();
    const showTiers = config.getShowTiers();
    const showDirect = config.getShowDirectModels();

    const tiers = showTiers ? ROUTING_MODELS : [];
    const direct = showDirect
      ? filterAndSortDirectModels(metadata.buildDirectModels(metadataObject))
      : [];

    const models = [...tiers, ...direct];
    const health = await router.checkHealth();

    return models.map((model) => {
      const limits = metadata.resolveModelLimits(model.id, metadataObject);
      const context = metadata.formatTokens(limits.contextLength);
      const expiry = limits.expirationDate
        ? ` · until ${limits.expirationDate}`
        : "";
      const favoriteMark = model.direct && isFavorite(model.id) ? "$(star) " : "";
      const modelDetail = model.direct
        ? `Direct free model · ${context} context${expiry}`
        : limits.modelName && model.id !== "automatic"
          ? `${limits.modelName} · ${context} context`
          : `${model.detail} · ${context} safe context`;
      return {
        ...model,
        name: `${favoriteMark}${model.name}`,
        detail: modelDetail,
        family: "openrouter-free",
        version: metadataObject?.updatedAt ?? "1",
        maxInputTokens: limits.contextLength,
        maxOutputTokens: limits.maxOutputTokens,
        tooltip: health.online
          ? `${modelDetail}. Routes through local FreeRouter.`
          : "Local router is offline. Run: auto-model-switcher start",
        capabilities: { imageInput: limits.imageInput, toolCalling: limits.toolCalling },
      };
    });
  }

  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const abortController = new AbortController();
    const cancellation = token.onCancellationRequested(() => abortController.abort());
    this.statusBar?.markBusy();
    try {
      const openAIMessages = toOpenAIMessages(messages, vscode);
      const tools = options.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        },
      }));
      const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required
        ? "required"
        : "auto";

      await router.requestChatCompletion({
        endpoint: config.getEndpoint(),
        model: model.id,
        messages: openAIMessages,
        tools,
        toolChoice,
        signal: abortController.signal,
        onText: (value) => progress.report(new vscode.LanguageModelTextPart(value)),
        onToolCall: (call) => progress.report(
          new vscode.LanguageModelToolCallPart(call.id, call.name, call.input),
        ),
      });
    } catch (err) {
      if (abortController.signal.aborted || err?.name === "AbortError") return;
      const layer = err?.layer ?? "vscode-extension";
      const message = `Auto Model Switcher (${layer}): ${err.message}`;
      logError(message);
      if (config.notificationWants("errors")) {
        vscode.window.showErrorMessage(message);
      }
      throw new Error(message, { cause: err });
    } finally {
      cancellation.dispose();
      this.statusBar?.markIdle();
    }
  }

  async provideTokenCount(_model, input) {
    if (typeof input === "string") return Math.ceil(input.length / 4);
    const messages = toOpenAIMessages([input], vscode);
    return Math.ceil(JSON.stringify(messages).length / 4);
  }

  dispose() {
    this.metadataWatcher?.close();
    this.changeEmitter.dispose();
  }
}

function registerCommands(context) {
  const reg = (id, fn) => vscode.commands.registerCommand(id, fn);
  context.subscriptions.push(
    reg("auto-model-switcher.manage", commands.configure),
    reg("auto-model-switcher.status", commands.showStatus),
    reg("auto-model-switcher.showStatus", commands.showStatus),
    reg("auto-model-switcher.refreshModels", commands.refreshModels),
    reg("auto-model-switcher.doctor", commands.showDoctor),
    reg("auto-model-switcher.startRouter", commands.startRouter),
    reg("auto-model-switcher.stopRouter", commands.stopRouter),
    reg("auto-model-switcher.restartRouter", commands.restartRouter),
    reg("auto-model-switcher.openLogs", commands.openLogs),
    reg("auto-model-switcher.openSettings", commands.openSettings),
    reg("auto-model-switcher.manageFavorites", commands.manageFavorites),
    reg("auto-model-switcher.browseModels", commands.browseModels),
    reg("auto-model-switcher.copyDiagnostics", commands.copyDiagnostics),
  );
}

function activate(context) {
  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);
  if (config.getDebugLogging()) show();

  const provider = new AutoModelProvider(statusBar);
  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider("auto-model-switcher", provider),
  );
  registerCommands(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("autoModelSwitcher")) {
        debug("Configuration changed; refreshing status and model list.");
        statusBar.refresh().catch((e) => debug(`refresh failed: ${e.message}`));
        provider.changeEmitter.fire();
      }
    }),
  );

  statusBar.refresh().catch((e) => debug(`initial refresh failed: ${e.message}`));
  log("Auto Model Switcher extension activated.");
}

function deactivate() {}

module.exports = { activate, deactivate };
