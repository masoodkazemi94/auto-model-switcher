"use strict";

// Configuration access and validation for the Auto Model Switcher extension.
// All settings are read through VS Code's configuration API so that edits in
// the Settings UI take effect immediately without a reinstall.

const vscode = require("vscode");

const SECTION = "autoModelSwitcher";

// Optional test override for the VS Code configuration object. When set, all
// getters read through it instead of the live workspace configuration.
let configOverride = null;

function setConfigOverride(value) {
  configOverride = value;
}

function readConfig() {
  if (configOverride) return configOverride;
  return vscode.workspace.getConfiguration(SECTION);
}

const NOTIFICATION_LEVELS = ["off", "errors", "warnings", "info"];
const DIRECT_SORT_OPTIONS = [
  "recommended",
  "name",
  "provider",
  "context",
  "output",
  "expiration",
];

function getString(key, fallback) {
  const value = readConfig().get(key, fallback);
  return typeof value === "string" ? value : fallback;
}

function getNumber(key, fallback) {
  const value = readConfig().get(key, fallback);
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function getBoolean(key, fallback) {
  const value = readConfig().get(key, fallback);
  return typeof value === "boolean" ? value : fallback;
}

function getArray(key, fallback) {
  const value = readConfig().get(key, fallback);
  return Array.isArray(value) ? value : fallback;
}

// Validate and normalize the router endpoint. Returns null when invalid so
// callers can surface a configuration error without sending a request.
function getEndpoint() {
  const raw = getString("endpoint", "http://127.0.0.1:18800").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Never allow embedded credentials in the endpoint.
  if (url.username || url.password) return null;
  return url.toString().replace(/\/$/, "");
}

function getConnectionTimeoutMs() {
  return Math.max(500, getNumber("connectionTimeoutMs", 3000));
}

function getRequestTimeoutMs() {
  return Math.max(1000, getNumber("requestTimeoutMs", 180_000));
}

function getHealthCheckTimeoutMs() {
  return Math.max(500, getNumber("healthCheckTimeoutMs", 2000));
}

function getNotificationLevel() {
  const value = getString("notificationLevel", "errors");
  return NOTIFICATION_LEVELS.includes(value) ? value : "errors";
}

function getDebugLogging() {
  return getBoolean("debugLogging", false);
}

function getShowTiers() {
  return getBoolean("showTiers", true);
}

function getShowDirectModels() {
  return getBoolean("showDirectModels", true);
}

function getDirectSort() {
  const value = getString("directSort", "recommended");
  return DIRECT_SORT_OPTIONS.includes(value) ? value : "recommended";
}

function getFavoriteModels() {
  const value = getArray("favoriteModels", []);
  return value.filter((item) => typeof item === "string");
}

function getIncludeModels() {
  return getArray("includeModels", []).filter((item) => typeof item === "string");
}

function getExcludeModels() {
  return getArray("excludeModels", []).filter((item) => typeof item === "string");
}

function getIncludeProviders() {
  return getArray("includeProviders", []).filter((item) => typeof item === "string");
}

function getExcludeProviders() {
  return getArray("excludeProviders", []).filter((item) => typeof item === "string");
}

function getMinimumContextWindow() {
  const value = getNumber("minimumContextWindow", 0);
  return value < 0 ? 0 : value;
}

function getHideExpiringWithinDays() {
  const value = getNumber("hideExpiringWithinDays", 0);
  return value < 0 ? 0 : value;
}

function getAutoRefresh() {
  return getBoolean("autoRefreshMetadata", true);
}

function notificationWants(level) {
  const order = { off: 0, errors: 1, warnings: 2, info: 3 };
  return order[getNotificationLevel()] >= order[level];
}

module.exports = {
  SECTION,
  NOTIFICATION_LEVELS,
  DIRECT_SORT_OPTIONS,
  getEndpoint,
  getConnectionTimeoutMs,
  getRequestTimeoutMs,
  getHealthCheckTimeoutMs,
  getNotificationLevel,
  getDebugLogging,
  getShowTiers,
  getShowDirectModels,
  getDirectSort,
  getFavoriteModels,
  getIncludeModels,
  getExcludeModels,
  getIncludeProviders,
  getExcludeProviders,
  getMinimumContextWindow,
  getHideExpiringWithinDays,
  getAutoRefresh,
  notificationWants,
  setConfigOverride,
};
