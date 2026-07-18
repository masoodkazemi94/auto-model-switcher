# Auto Model Switcher for VS Code

Auto Model Switcher adds the free models selected by the Auto Model Switcher
service to VS Code Chat. It supports normal chat, inline chat, and Agent mode
with tool calling.

The extension is the VS Code adapter. The local router, OpenRouter login,
model discovery, background service, and API-key storage are installed by the
main Auto Model Switcher installer.

## What it does

The extension:

- registers Auto Model Switcher as a VS Code language-model provider;
- adds five choices to the Chat model picker;
- converts VS Code chat messages into OpenAI-compatible messages;
- forwards Agent-mode tool definitions and tool results;
- streams text and tool calls from the local router back into VS Code;
- cancels the router request when you cancel the VS Code request;
- provides commands for configuration, status, and model refresh;
- displays a clear error when the local router is offline or an upstream call
  fails.

It does **not** contain an AI model, choose remote providers by itself, or store
your OpenRouter API key.

## How it works

```text
VS Code Chat / Agent mode
          |
          | messages and tool definitions
          v
Auto Model Switcher extension
          |
          | OpenAI-compatible request to 127.0.0.1:18800
          v
Local FreeRouter service
          |
          | classify task, select tier, retry free fallbacks
          v
OpenRouter free model
```

Only the last step leaves your machine. The extension communicates with the
local endpoint configured by `autoModelSwitcher.endpoint`.

## Requirements

- VS Code 1.104 or newer.
- Linux or macOS.
- The Auto Model Switcher service installed and running.
- An OpenRouter account and API key created by the installer.

Installing only this VSIX is not enough. From the main project directory, run:

```bash
./install.sh
```

The installer configures FreeRouter, authorizes OpenRouter, installs the
background service, refreshes free models, and installs this extension.

## Using the extension

1. Open VS Code Chat.
2. Open the model picker.
3. Select a model under **Auto Model Switcher**.
4. Use Ask, Edit, or Agent mode normally.

### Model choices

| Choice | Behavior |
| --- | --- |
| **Automatic** | Classifies each prompt locally and chooses the appropriate tier. Named differently from VS Code's built-in Auto choice. |
| **Fast** | Uses the fast tier for short questions and small edits. |
| **Balanced** | Uses the general coding tier for everyday development. |
| **Complex** | Uses the strongest available free tier for large or difficult work. |
| **Reasoning** | Uses the reasoning tier for analysis, planning, and difficult debugging. |

The names in the picker represent routing tiers, not permanent remote models.
OpenRouter changes its free catalog. The updater ranks the current catalog and
can change the model behind a tier without requiring an extension update.

Context and output limits are dynamic. Each explicit tier advertises the active
provider limits of its selected primary model. For example, a Nemotron tier can
advertise a 1M-token context when its active provider reports that limit. Auto
Router advertises the smallest context across its active tiers because it does
not choose the final tier until after receiving the prompt. Model picker details
show the current model name and context size, and update automatically when the
daily model refresh changes them.

Only models currently reporting zero prompt and completion prices, text input,
and `tools` plus `tool_choice` support are eligible. Each tier also has free
fallback models for rate limits or temporary provider failures.

Every eligible model also appears as an individual direct choice below the five
routing choices. Selecting **Tencent: Hy3 (free)**, for example, sends the
request directly to Hy3 without automatic tier selection or FreeRouter
fallbacks. Direct choices follow the live free catalog: newly eligible models
appear after refresh, while expired or paid models disappear automatically.

## Agent mode and tools

When VS Code supplies tools, the extension sends their names, descriptions,
and JSON schemas to FreeRouter. Model tool calls are streamed back as native VS
Code tool-call parts. VS Code remains responsible for asking permission,
running tools, and returning tool results to the model.

Tool quality depends on the free model selected at that time. A model can
support the tool-calling protocol and still make poor tool choices.

## Commands

Open the Command Palette and search for **Auto Model Switcher**:

- **Auto Model Switcher: Configure** — opens a terminal and runs the secure
  OpenRouter authorization flow.
- **Auto Model Switcher: Show Status** — checks whether the local router is
  online and shows its request count.
- **Auto Model Switcher: Refresh Free Models** — fetches and reranks the current
  OpenRouter free catalog.

The CLI provides deeper diagnostics:

```bash
auto-model-switcher doctor
auto-model-switcher status
auto-model-switcher logs
auto-model-switcher stats
auto-model-switcher test "Reply with exactly: OK"
```

## Settings

### `autoModelSwitcher.endpoint`

Local FreeRouter base URL.

- Default: `http://127.0.0.1:18800`
- Change it only when the router runs on another port or host.

Example `settings.json`:

```json
{
  "autoModelSwitcher.endpoint": "http://127.0.0.1:18800"
}
```

The API key does not belong in VS Code settings.

## Privacy and security

- The extension does not read the OpenRouter key.
- The key is stored by the installer in
  `~/.config/auto-model-switcher/secrets.env` with file mode `600`.
- Proxy settings are stored in `network.env`, also with mode `600`.
- FreeRouter listens on `127.0.0.1`, not on the public network.
- Prompts, selected context, tool schemas, and tool results sent by VS Code are
  forwarded through OpenRouter to the selected model provider.
- The extension has no telemetry implementation.

Do not attach files or workspace context that you are not willing to send to
the selected remote model provider.

## Remote development and WSL

The extension runs as a workspace extension. In WSL, SSH, or Dev Containers,
the router must run in the same remote environment as the extension so that
`127.0.0.1:18800` resolves to the correct machine.

For WSL, run the installer inside the WSL distribution. The VS Code CLI should
report that the extension was installed on WSL.

## Troubleshooting

### Router is offline

```bash
auto-model-switcher start
auto-model-switcher doctor
```

If needed, inspect logs:

```bash
auto-model-switcher logs
```

### HTTP 401 from OpenRouter

The stored key is missing, expired, or revoked:

```bash
auto-model-switcher configure
```

### HTTP 403: Access denied by security policy

Your network may require an outbound proxy. Run the installer again from a
terminal containing `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`:

```bash
./install.sh
auto-model-switcher doctor
```

The installer securely preserves these variables for the background service.

### HTTP 429 or all fallbacks fail

Free models have provider and account rate limits. Refresh the catalog or wait
for the limit to reset:

```bash
auto-model-switcher update-models
```

### Models do not appear in the picker

1. Run `auto-model-switcher doctor`.
2. Run **Developer: Reload Window**.
3. Open **Chat: Manage Language Models** and confirm Auto Model Switcher is
   enabled.

### Agent mode does not show a tier

VS Code only exposes Agent-mode models that declare tool calling. All generated
tiers declare it, but the extension and service must both be current. Rerun
`./install.sh`, then reload VS Code.

## Limitations

- Free does not mean unlimited; OpenRouter applies rate limits.
- Free-model availability and quality can change without notice.
- The extension provides chat and agent models. It does not replace every
  Cursor feature, semantic search, embeddings, or all inline-completion paths.
- Image input is currently disabled.
- Token counts are estimates because tiers can route to different tokenizers.
- A request already streaming cannot switch to a fallback midway through the
  stream.

## Uninstall

Complete removal, including the service, extension, generated configuration,
and stored key:

```bash
auto-model-switcher uninstall --yes
```

To remove only the VS Code extension, uninstall **Auto Model Switcher** from
the Extensions view. The local service will continue running until removed or
stopped separately.

## License

MIT
