"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");
const { requestChatCompletion, toOpenAIMessages } = require("./src/openai");
const {
  formatTokens,
  metadataPath,
  readModelMetadata,
  resolveModelLimits,
} = require("./src/model-metadata");

const MODELS = [
  { id: "auto", name: "Auto Router", detail: "Automatic task routing" },
  { id: "tier/simple", name: "Fast", detail: "Quick and lightweight" },
  { id: "tier/medium", name: "Balanced", detail: "Coding and daily work" },
  { id: "tier/complex", name: "Complex", detail: "Large or difficult changes" },
  { id: "tier/reasoning", name: "Reasoning", detail: "Deep analysis" },
];

class AutoModelProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
    try {
      this.metadataWatcher = fs.watch(path.dirname(metadataPath()), (_event, filename) => {
        if (!filename || filename.toString() === "models.json") this.changeEmitter.fire();
      });
    } catch {
      this.metadataWatcher = null;
    }
  }

  async provideLanguageModelChatInformation() {
    const endpoint = configuredEndpoint();
    const metadata = readModelMetadata();
    let available = false;
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1500) });
      available = response.ok;
    } catch {
      available = false;
    }

    return MODELS.map((model) => {
      const limits = resolveModelLimits(model.id, metadata);
      const context = formatTokens(limits.contextLength);
      const modelDetail = limits.modelName && model.id !== "auto"
        ? `${limits.modelName} · ${context} context`
        : `${model.detail} · ${context} safe context`;
      return {
        ...model,
        detail: modelDetail,
        family: "openrouter-free",
        version: metadata?.updatedAt ?? "1",
        maxInputTokens: limits.contextLength,
        maxOutputTokens: limits.maxOutputTokens,
        tooltip: available
          ? `${modelDetail}. Routes through local FreeRouter.`
          : "Local router is offline. Run: auto-model-switcher start",
        capabilities: { imageInput: false, toolCalling: true },
      };
    });
  }

  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    const abortController = new AbortController();
    const cancellation = token.onCancellationRequested(() => abortController.abort());
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

      await requestChatCompletion({
        endpoint: configuredEndpoint(),
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
    } catch (error) {
      if (abortController.signal.aborted) return;
      throw new Error(`Auto Model Switcher: ${error.message}`, { cause: error });
    } finally {
      cancellation.dispose();
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

function configuredEndpoint() {
  return vscode.workspace.getConfiguration("autoModelSwitcher")
    .get("endpoint", "http://127.0.0.1:18800")
    .replace(/\/$/, "");
}

function runCli(command) {
  const terminal = vscode.window.createTerminal({ name: "Auto Model Switcher" });
  terminal.show();
  terminal.sendText(`auto-model-switcher ${command}`);
}

function activate(context) {
  const provider = new AutoModelProvider();
  context.subscriptions.push(
    provider,
    vscode.lm.registerLanguageModelChatProvider("auto-model-switcher", provider),
    vscode.commands.registerCommand("auto-model-switcher.manage", () => runCli("configure")),
    vscode.commands.registerCommand("auto-model-switcher.refreshModels", () => runCli("update-models")),
    vscode.commands.registerCommand("auto-model-switcher.status", async () => {
      try {
        const response = await fetch(`${configuredEndpoint()}/health`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const health = await response.json();
        vscode.window.showInformationMessage(
          `Auto Model Switcher online — ${health.stats?.requests ?? 0} requests`,
        );
      } catch (error) {
        const action = await vscode.window.showErrorMessage(
          `Auto Model Switcher offline: ${error.message}`,
          "Start",
        );
        if (action === "Start") runCli("start");
      }
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
