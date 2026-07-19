# Changelog

All notable changes to Auto Model Switcher are documented here. The project
follows a simple date-based log; releases are tagged from `main`.

## Unreleased — VS Code extension overhaul

### Added
- Rich, validated VS Code settings: local router endpoint, connection/request/
  health-check timeouts, show/hide tiers and direct models, favorite models,
  include/exclude model IDs and providers, direct-model sorting, minimum
  context-window filter, expiration hide window, notification level, debug
  logging, and automatic metadata refresh.
- Status-bar item showing router online/offline and active-request state.
- Output channel with sanitized (secret-redacted) logging.
- Commands: Run Doctor, Start/Stop/Restart Router, Open Logs, Open Settings,
  Manage Favorite Models, Browse Models, and Copy Sanitized Diagnostics.
- Robust SSE parser handling CRLF/LF, UTF-8 and `data:` splits across chunks,
  multiple `data:` lines, `[DONE]`, comments, and malformed JSON.
- Actionable, layer-tagged HTTP error classification (401/403/404/429/500/502/
  503) plus timeout, connection-refused, and streamed-error handling.
- Cached and debounced metadata with safe defaults for the extended schema
  (provider, image-input, tool-calling, role, expiration).
- Focused, dependency-free CommonJS modules: config, logging, router-client,
  sse, metadata, models, statusbar, commands, diagnostics.
- Unit tests for settings defaults/validation, filtering, sorting, favorites,
  expiration, dynamic limits, old-metadata compatibility, SSE boundaries,
  tool-call reassembly, sanitization, and HTTP classification.

### Changed
- Dynamic context and output limits remain correct and are never advertised
  larger than the selected backend supports.
- "Automatic" stays distinct from VS Code's built-in "Auto" label.
- Service control is performed through fixed CLI commands (no shell
  interpolation of untrusted values).

### Security
- Extension never reads or stores the OpenRouter key; no telemetry; URLs are
  validated; logs and copied diagnostics are sanitized.

## 0.1.3
- Expose direct free OpenRouter models in the VS Code model picker.
- Dynamic per-model context and output limits.

## 0.1.2
- Document the VS Code extension.

## 0.1.1
- Honor proxy settings inside the router service.

## 0.1.0
- Initial automatic free model switcher with FreeRouter patch, installer, and
  VS Code Language Model Chat Provider.
