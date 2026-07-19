# Auto Model Switcher for VS Code

Auto Model Switcher adds the current free OpenRouter models — selected by the
local Auto Model Switcher service — to VS Code Chat, Edits, and Agent mode. It
supports streaming text, tool calling, dynamic context limits, a status bar,
quick model browsing, favorites, filters, and rich diagnostics.

The extension is the **VS Code adapter only**. The local FreeRouter service,
OpenRouter login, model discovery, background service, and API-key storage are
installed by the main Auto Model Switcher installer (`install.sh`). This
extension never contains an AI model, chooses remote providers by itself, or
stores your OpenRouter API key.

## What problem it solves

VS Code's language-model picker is built around paid providers. Many capable
free OpenRouter models exist, but they change constantly, have tight rate
limits, and need an OpenAI-compatible proxy. Auto Model Switcher keeps a small
local router that ranks the current free catalog into routing tiers, exposes
those tiers plus every eligible free model directly in VS Code, and isolates
your API key from the editor.

## How Automatic routing works

When you pick **Automatic**, the local router classifies each prompt and
selects the best tier (fast, balanced, complex, or reasoning) *after* seeing
the prompt. Because the final tier is unknown until then, the **Automatic**
choice advertises the *smallest* active context and output limit across all
tiers. Picking a specific tier (Fast/Balanced/Complex/Reasoning) advertises that
tier's current primary model limits instead.

The names in the picker are **routing tiers**, not permanent remote models.
OpenRouter changes the free catalog daily; the updater reranks it and can change
the model behind a tier without an extension update.

> **Note on naming:** the choice is called **Automatic** (not "Auto") so it does
> not collide with VS Code's built-in *Auto* label.

## Difference between Automatic, tier, and direct models

| Choice | Behavior |
| --- | --- |
| **Automatic** | Classifies each prompt locally and chooses the appropriate tier. |
| **Fast** | Fast tier for short questions and small edits. |
| **Balanced** | General coding tier for everyday development. |
| **Complex** | Strongest free tier for large or difficult changes. |
| **Reasoning** | Reasoning tier for analysis, planning, and difficult debugging. |
| **Direct model** (e.g. *Tencent: Hy3 (free)*) | Sends the request straight to that model — no tier classification, no FreeRouter fallbacks. |

Every eligible free model also appears as an individual **direct** choice below
the routing tiers. Direct choices follow the live free catalog: newly eligible
models appear after a refresh, while expired or paid models disappear
automatically.

## How free models are discovered

`scripts/update-models.mjs` (run by the installer and the daily refresh) queries
the OpenRouter model list and keeps only models that are:

- free (prompt **and** completion price reported as `0`);
- text in / text out;
- support `tools` **and** `tool_choice` (required for VS Code Agent mode);
- have at least 32K context;
- not safety/moderation/embedding/guard models.

It then scores and ranks them into the four tiers. The resulting metadata is
written to `~/.config/auto-model-switcher/models.json`, which this extension
reads.

## Why a model might not appear

- The free catalog changed and the model is now paid or removed.
- The model lost `tools`/`tool_choice` support.
- A `minimumContextWindow`, `includeModels`, `excludeModels`,
  `includeProviders`, or `excludeProviders` setting hides it.
- It expires within `hideExpiringWithinDays` days.
- The metadata file is missing or the router is offline (the picker still shows
  routing tiers, but requests will fail until the router returns).
- In Agent mode, only models that declare tool calling are usable.

## Dynamic context limits

Context and output limits are **dynamic** and never advertised larger than the
selected backend can safely handle:

- A tier shows the live limits of its current primary model.
- Direct models show their own metadata limits.
- **Automatic** shows the smallest active tier limits.
- Limits update automatically when the daily refresh rewrites the metadata.

## Tool-calling support

Agent mode works because every tier primary and every eligible direct model
supports tool calling. Tool definitions, tool results, and streamed tool calls
are forwarded as native VS Code tool-call parts. Tool quality depends on the
free model selected at the time — a model can support the protocol and still
make poor tool choices.

## Image-input limitations

Direct models may advertise image-input support when the metadata reports it.
The extension surfaces that flag in the picker, but many free models do not
accept images. Treat image input as best-effort and confirm with the model
provider's documentation.

## Installation

Installing only this VSIX is **not** enough. From the main project directory:

```bash
./install.sh
```

The installer configures FreeRouter, authorizes OpenRouter (OAuth or manual
key), installs the background service, refreshes free models, and installs this
extension.

## First-time setup

1. Run `./install.sh` (or `auto-model-switcher configure` if the key is missing).
2. Confirm the router is online: **Auto Model Switcher: Show Status**.
3. Open VS Code Chat, open the model picker, and select **Automatic** or any
   tier/direct model.

## Available commands

Open the Command Palette and search **Auto Model Switcher**:

| Command | What it does |
| --- | --- |
| Configure | Opens a terminal and runs the secure OpenRouter authorization flow. |
| Show Status | Checks whether the local router is online and shows its request count. |
| Refresh Free Models | Fetches and reranks the current OpenRouter free catalog. |
| Run Doctor | Runs connectivity and metadata health checks. |
| Start / Stop / Restart Router | Controls the local router service. |
| Open Router Logs | Streams router logs in a terminal. |
| Open Settings | Opens this extension's Settings page. |
| Manage Favorite Models | Multi-select direct models to pin to the top of the picker. |
| Browse Models | Quick Pick listing every direct free model with limits. |
| Copy Sanitized Diagnostics | Copies a troubleshooting summary to the clipboard (no secrets). |

## Settings

All settings are under the `autoModelSwitcher.*` namespace and take effect
immediately — no reinstall required.

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `endpoint` | string | `http://127.0.0.1:18800` | Local FreeRouter base URL. Must be http(s) and must not contain credentials. |
| `connectionTimeoutMs` | number | `3000` | Timeout for connecting to the router health endpoint. |
| `requestTimeoutMs` | number | `120000` | Timeout for a chat completion request. |
| `healthCheckTimeoutMs` | number | `2000` | Timeout for the status-bar health check. |
| `showTiers` | boolean | `true` | Show the Automatic/Fast/Balanced/Complex/Reasoning tiers. |
| `showDirectModels` | boolean | `true` | Show individual eligible free models. |
| `favoriteModels` | string[] | `[]` | OpenRouter model IDs shown first in the picker (favorites always on top). |
| `includeModels` | string[] | `[]` | If non-empty, only these model IDs appear. |
| `excludeModels` | string[] | `[]` | Model IDs to hide. |
| `includeProviders` | string[] | `[]` | If non-empty, only these providers appear. |
| `excludeProviders` | string[] | `[]` | Providers to hide. |
| `directSort` | enum | `recommended` | Direct-model sort: `recommended`, `name`, `provider`, `context`, `output`, `expiration`. |
| `minimumContextWindow` | number | `0` | Hide direct models with smaller context. |
| `hideExpiringWithinDays` | number | `0` | Hide direct models expiring within N days (0 disables). |
| `notificationLevel` | enum | `errors` | `off`, `errors`, `warnings`, `info`. |
| `debugLogging` | boolean | `false` | Write detailed diagnostic logs to the Output channel. |
| `autoRefreshMetadata` | boolean | `true` | Watch the metadata file and refresh the picker when it changes. |

The API key is **never** part of these settings.

## Status bar behavior

A status-bar item (right side) shows:

- `$(check) AutoMS: ready` — router online and idle.
- `$(stop) AutoMS: offline` — router unreachable (hover for the reason).
- `$(sync~spin) AutoMS: requesting` — an active chat/agent request is in flight.

Click it to open the status command. Offline state uses a warning background so
it is noticeable.

## Model favorites and filters

- **Favorites:** run *Manage Favorite Models* (or set `favoriteModels`) to float
  chosen direct models to the top of the picker. Favorites are always shown
  first regardless of `directSort`.
- **Filters:** use `include*`/`exclude*`/`minimumContextWindow`/
  `hideExpiringWithinDays` to trim the direct list. Routing tiers are never
  filtered.
- **Sorting:** `directSort` controls the order of non-favorite direct models.

## Remote VS Code behavior

The extension is a **workspace** extension. In WSL, SSH, or Dev Containers the
router must run in the **same remote environment** as the extension host, so
that `127.0.0.1:18800` resolves to the correct machine. A router running on
your local desktop is **not** reachable from a remote extension host through
loopback.

- For WSL/SSH: run `./install.sh` *inside* the remote shell; the VS Code CLI
  will report the extension installed on that remote.
- For Dev Containers: install the CLI and router inside the container image or
  a post-create script.

If the status bar shows offline while the router is clearly running locally,
check that you installed into the same environment VS Code is connected to.

## Privacy and API-key handling

- The extension **never reads** the OpenRouter key.
- The key is stored by the installer in
  `~/.config/auto-model-switcher/secrets.env` (mode `600`).
- Proxy settings live in `network.env` (mode `600`); the extension never
  exposes proxy credentials.
- FreeRouter listens only on `127.0.0.1`.
- Prompts, selected context, tool schemas, and tool results sent by VS Code are
  forwarded through OpenRouter to the selected model provider.
- The extension has **no telemetry** and makes **no external analytics calls**.
- Logs and copied diagnostics are sanitized: API keys, `Bearer` tokens, and
  `Authorization` headers are redacted.

Do not attach files or workspace context you are not willing to send to the
selected remote model provider.

## Logs and diagnostics

- Output channel: **Auto Model Switcher** (open via *Open Settings* → show, or
  enable `debugLogging`).
- *Run Doctor* prints connectivity and metadata checks.
- *Copy Sanitized Diagnostics* puts a redacted summary on the clipboard for bug
  reports.

## Troubleshooting

### Router offline

```bash
auto-model-switcher start
auto-model-switcher doctor
```

### 403 — Access denied by security policy

Your network likely requires an outbound proxy that the background service is
missing:

```bash
./install.sh        # rerun from a shell with HTTP_PROXY/HTTPS_PROXY/NO_PROXY set
auto-model-switcher doctor
```

The installer preserves these variables (mode `600`) for the service.

### 429 — Rate limiting

Free models have tight provider/account limits. Wait for the limit to reset or
refresh the catalog:

```bash
auto-model-switcher update-models
```

### 502 — Upstream failure

OpenRouter or the model provider is unreachable. Retry later; the tiers retry
their free fallbacks automatically.

### Missing metadata

`models.json` is absent or unreadable. Regenerate it:

```bash
auto-model-switcher update-models
```

The extension keeps the last good metadata if the file is briefly unavailable.

### No eligible models

The free catalog currently has fewer than four tool-capable free models, or your
filters hide everything. Loosen `include*`/`exclude*`/`minimumContextWindow`
settings or run *Refresh Free Models*.

### Model expired

A direct model past its `expirationDate` is hidden automatically. Refresh the
catalog to pick up a replacement.

### WSL or SSH endpoint problems

The router must run in the same environment as the extension host. Re-run
`./install.sh` inside the remote shell and reload VS Code.

## Uninstallation

Full removal (service, extension, generated config, and stored key):

```bash
auto-model-switcher uninstall --yes
```

To remove only the VS Code extension, uninstall **Auto Model Switcher** from the
Extensions view; the local service keeps running until stopped separately.

## Development and testing

```bash
cd vscode-extension
npm install --ignore-scripts
npm test                 # node --test with a vscode shim
npm run package          # builds auto-model-switcher.vsix
```

Root-level checks:

```bash
node --test tests/update-models.test.mjs
./tests/verify.sh
```

The extension is plain CommonJS JavaScript with no build step; `src/` holds the
focused modules (config, logging, router-client, sse, metadata, models,
statusbar, commands, diagnostics). `test/vscode-shim.js` provides a minimal
`vscode` stub so the pure logic runs under plain Node.

## License

MIT
