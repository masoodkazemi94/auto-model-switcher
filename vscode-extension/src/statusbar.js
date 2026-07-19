"use strict";

// Status bar integration. Shows router online/offline, the current routing mode
// or selected model during an active request, and clears the activity state
// when the request finishes or is cancelled.

const vscode = require("vscode");
const { checkHealth } = require("./router-client");
const { log, debug } = require("./logging");

const OFFLINE_TEXT = "$(stop) AutoMS: offline";
const ONLINE_TEXT = "$(check) AutoMS: ready";
const BUSY_TEXT = "$(sync~spin) AutoMS: requesting";

class StatusBar {
  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.name = "Auto Model Switcher";
    this.item.command = "auto-model-switcher.showStatus";
    this.item.text = "$(loading~spin) AutoMS";
    this.item.tooltip = "Auto Model Switcher — checking router…";
    this.item.show();
    this.busy = 0;
  }

  async refresh() {
    const health = await checkHealth();
    if (health.online) {
      this.item.text = this.busy > 0 ? BUSY_TEXT : ONLINE_TEXT;
      this.item.tooltip = `Auto Model Switcher — router online${
        health.stats?.requests != null ? ` · ${health.stats.requests} requests` : ""
      }`;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = OFFLINE_TEXT;
      this.item.tooltip = `Auto Model Switcher — router offline (${health.reason ?? "unknown"})`;
      this.item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }
  }

  markBusy() {
    this.busy += 1;
    this.item.text = BUSY_TEXT;
  }

  markIdle() {
    this.busy = Math.max(0, this.busy - 1);
    if (this.busy === 0) {
      // Defer to refresh so we show the real online/offline state.
      this.refresh().catch((error) => debug(`status refresh failed: ${error.message}`));
    }
  }

  dispose() {
    this.item.dispose();
  }
}

module.exports = { StatusBar };
