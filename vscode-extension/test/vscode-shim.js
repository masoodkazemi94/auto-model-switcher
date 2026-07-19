"use strict";

// Minimal `vscode` API shim so the extension's pure modules can be unit-tested
// under plain Node. Only the surface used by src/* is faked. This file is
// registered via `node --require` in the npm test script and is never shipped.

const Module = require("node:module");

const vscode = {
  window: {
    createOutputChannel: () => ({
      appendLine() {},
      show() {},
      dispose() {},
    }),
    createStatusBarItem: () => ({
      show() {}, dispose() {},
    }),
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showQuickPick: async () => undefined,
    createTerminal: () => ({ show() {}, sendText() {} }),
  },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => fallback,
      update: async () => {},
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async () => undefined,
  },
  lm: {
    registerLanguageModelChatProvider: () => ({ dispose() {} }),
  },
  env: {
    clipboard: { writeText: async () => {} },
  },
  EventEmitter: class {
    constructor() { this.event = () => ({ dispose() {} }); }
    fire() {}
    dispose() {}
  },
  StatusBarAlignment: { Right: 1, Left: 2 },
  ThemeColor: class { constructor(c) { this.id = c; } },
  LanguageModelChatMessageRole: { User: 1, Assistant: 2 },
  LanguageModelChatToolMode: { Required: "required", Auto: "auto" },
  LanguageModelTextPart: class { constructor(value) { this.value = value; } },
  LanguageModelToolCallPart: class { constructor(callId, name, input) { this.callId = callId; this.name = name; this.input = input; } },
  LanguageModelToolResultPart: class { constructor(callId, content) { this.callId = callId; this.content = content; } },
  version: "1.104.0",
  ConfigurationTarget: { Global: 1, Workspace: 2 },
};

// Intercept `require("vscode")` and return the shim during tests.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") return vscode;
  return originalLoad.apply(this, arguments);
};

module.exports = vscode;
