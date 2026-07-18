"use strict";

const vscode = require("vscode");
const { requestChatCompletion, toOpenAIMessages } = require("./src/openai");

const MODELS = [
  { id: "auto", name: "Auto Router", detail: "Automatic task routing" },
  { id: "tier/simple", name: "Fast", detail: "Quick and lightweight" },
  { id: "tier/medium", name: "Balanced", detail: "Coding and daily work" },
  { id: "tier/complex", name: "Complex", detail: "Large or difficult changes" },
  { id: "tier/reasoning", name: "Reasoning", detail: "Deep analysis" },
];

class AutoModelProvider {
  async provideLanguageModelChatInformation() {
    const endpoint = configuredEndpoint();
    let available = false;
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(1500) });
      available = response.ok;
    } catch {
      available = false;
    }

    return MODELS.map((model) => ({
      ...model,
      family: "openrouter-free",
      version: "1",
      maxInputTokens: 120_000,
      maxOutputTokens: 16_384,
      tooltip: available
        ? `${model.detail}. Routes through local FreeRouter.`
        : "Local router is offline. Run: auto-model-switcher start",
      capabilities: { imageInput: false, toolCalling: true },
    }));
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
  context.subscriptions.push(
    vscode.lm.registerLanguageModelChatProvider("auto-model-switcher", new AutoModelProvider()),
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
