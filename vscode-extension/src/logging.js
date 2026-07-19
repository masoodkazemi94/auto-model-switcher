"use strict";

// Centralized logging to a VS Code output channel. Debug logging is opt-in via
// the `autoModelSwitcher.debugLogging` setting. No prompts, conversation
// contents, secrets, or full request/response bodies are ever written here.

const vscode = require("vscode");
const { getDebugLogging } = require("./config");

let channel = null;

function getChannel() {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Auto Model Switcher");
  }
  return channel;
}

function sanitize(text) {
  if (text == null) return "";
  return String(text)
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "***REDACTED-KEY***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***REDACTED***")
    .replace(/Authorization:\s*\S+/gi, "Authorization: ***REDACTED***");
}

function log(message, ...args) {
  const formatted = args.length
    ? `${message} ${args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")}`
    : message;
  getChannel().appendLine(`[info] ${sanitize(formatted)}`);
}

function debug(message, ...args) {
  if (!getDebugLogging()) return;
  const formatted = args.length
    ? `${message} ${args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")}`
    : message;
  getChannel().appendLine(`[debug] ${sanitize(formatted)}`);
}

function warn(message) {
  getChannel().appendLine(`[warn] ${sanitize(message)}`);
}

function error(message) {
  getChannel().appendLine(`[error] ${sanitize(message)}`);
}

function show() {
  getChannel().show(true);
}

module.exports = { getChannel, log, debug, warn, error, show, sanitize };
