# Auto Model Switcher

Cursor-like model choice inside VS Code, using current free OpenRouter models
and a local [FreeRouter](https://github.com/openfreerouter/freerouter) classifier.

One installer:

- installs a private Node.js runtime when Node 20+ is unavailable;
- installs and patches a pinned FreeRouter release;
- obtains an OpenRouter API key through OAuth PKCE;
- discovers zero-price models with tool-calling support;
- ranks models into fast, balanced, complex, and reasoning tiers;
- runs the router through systemd on Linux or launchd on macOS;
- refreshes the free-model set daily;
- installs a VS Code Language Model Chat Provider with Agent-mode tools.

## Install

Requirements: Linux or macOS, `bash`, `curl`, `git`, and VS Code. On Linux,
systemd user services must be available.

```bash
git clone <this-repository-url> auto-model-switcher
cd auto-model-switcher
./install.sh
```

The browser authorization uses OpenRouter's documented localhost OAuth PKCE
flow. The returned API key is stored in
`~/.config/auto-model-switcher/secrets.env` with mode `600`; it is never written
to VS Code settings or printed. For an SSH machine:

```bash
auto-model-switcher configure --manual
```

Then open VS Code Chat, choose **Manage Language Models**, and select one of:

- **Auto Router** — classify every prompt locally;
- **Fast** — short questions and small edits;
- **Balanced** — normal coding work;
- **Complex** — architecture and large changes;
- **Reasoning** — deep analysis and difficult debugging.

All choices use OpenRouter models whose prompt and completion prices are both
reported as zero when the daily refresh runs. Models without `tools` and
`tool_choice` support are excluded so VS Code Agent mode remains usable.

## Commands

```text
auto-model-switcher configure
auto-model-switcher update-models
auto-model-switcher pin reasoning nvidia/example-model:free
auto-model-switcher unpin reasoning
auto-model-switcher start|stop|restart|status
auto-model-switcher logs
auto-model-switcher stats
auto-model-switcher doctor
auto-model-switcher test "Fix a race condition"
auto-model-switcher install-vscode
auto-model-switcher uninstall --yes
```

Pins are validated on every refresh. A pinned model that stops being free or
loses tool support causes the refresh to fail instead of silently using a paid
model.

## Layout after installation

```text
~/.local/share/auto-model-switcher/    application, Node runtime, FreeRouter
~/.config/auto-model-switcher/         key, generated model config, pins
~/.local/bin/auto-model-switcher       CLI symlink
```

FreeRouter listens only on `127.0.0.1:18800`. VS Code talks to this local
endpoint. Requests then go to OpenRouter using the locally stored key.

## Free does not mean unlimited

OpenRouter applies rate limits to free models and can change availability. The
generated configuration includes four fallbacks per tier. No paid model is ever
selected automatically. Review current limits in the
[OpenRouter FAQ](https://openrouter.ai/docs/faq) and current models in the
[free collection](https://openrouter.ai/collections/free-models).

VS Code BYOK supports chat and agent workflows. Some editor capabilities such
as semantic search or specific inline-completion paths can still depend on
GitHub/Copilot. See [VS Code language model
configuration](https://code.visualstudio.com/docs/agent-customization/language-models).

## Development

```bash
./tests/verify.sh
cd vscode-extension
npm install --ignore-scripts
npm test
npm run package
```

FreeRouter is pinned because `patches/freerouter-vscode.patch` adds required
OpenAI tool forwarding and explicit tier model IDs. Update the commit and patch
together.
