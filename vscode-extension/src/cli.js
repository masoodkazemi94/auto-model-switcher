"use strict";

// Safe execution helpers for the CLI. We never interpolate untrusted values
// into a shell command; instead we open a terminal and send a fixed command
// string, or run a fixed command via the process API for service control.

const vscode = require("vscode");

// Open an interactive terminal and send a fixed, well-known CLI command.
// No user-supplied values are interpolated here.
function runCliCommand(command) {
  const terminal = vscode.window.createTerminal({ name: "Auto Model Switcher" });
  terminal.show();
  terminal.sendText(`auto-model-switcher ${command}`);
}

// Known-good service actions executed through the CLI in a terminal. Each value
// is a static string so there is no shell-injection surface.
const SERVICE_ACTIONS = ["start", "stop", "restart"];

function runServiceAction(action) {
  if (!SERVICE_ACTIONS.includes(action)) {
    throw new Error(`Unknown service action: ${action}`);
  }
  runCliCommand(action);
}

module.exports = { runCliCommand, runServiceAction, SERVICE_ACTIONS };
