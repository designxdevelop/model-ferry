# Model Ferry

Model Ferry makes the models and presets available to your Cursor account usable across your local agent stack. OpenCode gets native variants, Pi and Hermes Agent configure automatically when installed, and any same-machine client with a custom OpenAI Chat Completions provider can connect to the same loopback-only bridge.

It adds three things on top of the Cursor Agent SDK:

- The bridge starts at login through `launchd` on macOS, a systemd user service on Linux, or Windows Task Scheduler on Windows 10 and 11. Authentication uses the Cursor SDK's stored browser login, or `CURSOR_API_KEY` when set.
- Its installer scans PATH and well-known config homes for 40+ local agent harnesses. It adds a Model Ferry provider to supported agents it finds without changing any selected or default model.
- Its local OpenAI-compatible API lets additional clients connect manually while keeping shell commands, file edits, and other function tools in the originating client.

## Client compatibility

| Client | Setup | Provider name | Cursor presets |
| --- | --- | --- | --- |
| OpenCode 1.x / 2.0 | Automatic | **Cursor** | Native variants |
| Pi | Automatic when installed | **Model Ferry** (`modelferry`) | `model@variant` entries |
| Hermes Agent | Automatic when installed | **Model Ferry** (`modelferry`) | `model@variant` entries |
| Other local OpenAI-compatible clients | Manual | Your choice | Base models or `model@variant` |

Automatic setup means Model Ferry owns only its provider entry. Existing providers, settings, and default-model selections are preserved. Run `modelferry agents` to scan PATH and well-known config directories and see what is installed. The result distinguishes **automatic setup** from **detected only**; detection alone does not imply that a harness supports custom OpenAI providers or that Model Ferry edits its config.

```text
$ modelferry agents
Detected 6 local agent harnesses:
  OpenCode     automatic setup
  Pi           automatic setup
  Claude Code  detected only
  Codex        detected only
  Cursor       detected only
  Gemini CLI   detected only
```

The discovery registry includes more than 40 common coding agents and harnesses, with both binary and config-directory markers. If you install Pi or Hermes after Model Ferry, run `modelferry refresh` to detect and configure it. Use `modelferry agents --json` when another installer or script needs the scan results.

### Connect another local client manually

Use these custom-provider settings:

| Setting | Value |
| --- | --- |
| API format | OpenAI Chat Completions |
| Base URL | `http://127.0.0.1:<port>/v1` |
| API key | `localToken` from `~/.config/modelferry/config.json` |
| Model | Any ID from `modelferry models` |

A typical client-side provider entry looks like this (field names vary by client):

```json
{
  "baseURL": "http://127.0.0.1:8791/v1",
  "apiKey": "<localToken>",
  "api": "openai-completions"
}
```

Run `modelferry status` to confirm the resolved port. The default is `8791`; Model Ferry selects a nearby free port when necessary and updates automatically managed clients. Standard OpenAI function tools are supported and returned to the originating client for execution.

The API is intentionally loopback-only. A client running on another machine—or in a container without access to the host loopback interface—cannot connect directly.

## Install

**Quick install** — clones the repo to `~/.modelferry`, installs dependencies, and runs setup:

```sh
curl -fsSL https://ferry.designxdevelop.com/install.sh | bash
```

**Windows 10 / Windows 11** — in PowerShell, run:

```powershell
irm https://ferry.designxdevelop.com/install.ps1 | iex
```

**Manual setup** — clone, install, and sign in:

```sh
git clone https://github.com/designxdevelop/model-ferry.git
cd model-ferry
npm install
npm run setup
```

The first time, `setup` signs you in with your Cursor account: a browser opens to complete a Cursor sign-in, and the SDK mints a 90-day API key stored at `~/.cursor/sdk/auth.json`. If you already have a Cursor API key, set `CURSOR_API_KEY` and run setup again — no browser login needed.

The setup command creates:

- macOS: `~/Library/LaunchAgents/ai.dxd.modelferry.plist`
- Linux: `~/.config/systemd/user/ai.dxd.modelferry.service`
- Windows: a per-user **Model Ferry** Task Scheduler task (logon trigger + keepalive wrapper)
- a `cursorapi` provider in `~/.config/opencode/opencode.json` (V1 `provider.cursorapi` and OpenCode 2.0 `providers.cursorapi`)
- a `modelferry` provider in `~/.pi/agent/models.json` when Pi is installed
- a `modelferry` provider in `~/.hermes/config.yaml` when Hermes Agent is installed (`%LOCALAPPDATA%\hermes\config.yaml` on native Windows)

It backs up existing client configs before changing them and preserves every existing default model exactly. `modelferry refresh` keeps each automatically managed client synchronized and rescans for Pi and Hermes. `modelferry uninstall` removes only Model Ferry's provider entries.

Setup prints every automatically configured client plus every other recognized harness it detects. Other clients use the manual connection settings above only when they support a custom OpenAI Chat Completions provider.

## Authentication

The bridge never stores Cursor credentials itself. It relies on the Cursor SDK's auth resolution, in this order:

1. `CURSOR_API_KEY` environment variable
2. A stored browser login from `Cursor.auth.login()` (`~/.cursor/sdk/auth.json`)

A visual setup page is served at `http://127.0.0.1:8791/onboard`. `npm run setup` and `npm run login` open it in your browser on first use — sign in with Cursor there and the page shows your account, key expiry, and model count. Sign-in itself happens on Cursor's website; the minted key is labeled **Model Ferry** in your Cursor dashboard API-keys list.

```sh
npm run login    # browser login; always mints a fresh 90-day API key
npm run logout   # clear the stored browser login
npm run status   # shows auth state and bridge health
```

On headless or remote machines where a browser can't be opened automatically, `login` prints the Cursor sign-in URL to the terminal — open it in any browser (even on another device) and approve, and the bridge picks it up and mints the key.

The bridge runs as a background service, which does not inherit shell environment variables. A stored browser login works there out of the box. To use `CURSOR_API_KEY`, set it for the service manager too:

- macOS: `launchctl setenv CURSOR_API_KEY <key>`
- Linux: put `CURSOR_API_KEY=...` in `~/.config/environment.d/modelferry.conf`, then run `systemctl --user daemon-reload` and `systemctl --user restart ai.dxd.modelferry.service` (a one-shot `systemctl --user import-environment CURSOR_API_KEY` only lasts for the current user-manager session)
- Windows: put `set CURSOR_API_KEY=<key>` in `%USERPROFILE%\.config\modelferry\environment.cmd`, then restart the **Model Ferry** task (`modelferry` setup/login does this automatically when `CURSOR_API_KEY` is already set in the installing shell). `setx` alone is not enough for the running logon session.

### Auto-renewal

Browser-login keys expire after 90 days. The bridge automatically re-runs the browser login and mints a fresh key when expiry is within the renewal window (3 days by default, `loginRenewMs` in `~/.config/modelferry/config.json`) — at startup, on its six-hour refresh cycle, and before a chat run that would otherwise use an expiring key. If renewal is missed and the key lapses, chat requests fail with HTTP `503` and error code `not_authenticated` (or `auth_renewal_failed` when a renewal attempt itself failed), with a message pointing to the setup page and `modelferry login`.

## Ports

The bridge listens on `127.0.0.1:8791` by default. If that port is already in use, it scans the next 19 ports and binds the first free one, then records the resolved port in `~/.config/modelferry/config.json` so automatically configured providers, the onboarding page, and the CLI commands all agree on it.

## Use

Start your agent normally, then choose its Model Ferry provider:

- **OpenCode:** choose **Cursor**, then select a model. OpenCode's variant selector (or `ctrl+t`) switches between the exact thinking, reasoning, effort, context, and fast combinations advertised by Cursor.
- **Pi:** choose **Model Ferry** from `/model`. Presets appear as deterministic `model@variant` entries, such as `gpt-5.6-sol@1m-high-standard`.
- **Hermes Agent:** choose **Model Ferry** from `/model` or `hermes model`. Presets use the same `model@variant` identifiers.
- **Other clients:** choose the custom provider you created, then select a base model or enter a `model@variant` identifier.

The installer only adds providers; it never switches the model currently selected by any client.

From the CLI, pass a native variant preset with `--variant`:

```sh
opencode run -m cursorapi/gpt-5.6-sol --variant 1m-high-standard "Explain this repository"
```

Variant names are generated from Cursor's canonical parameters. Only combinations explicitly returned by Cursor are offered.

## Catalog refresh

The bridge refreshes Cursor's catalog at startup and every six hours. It updates only its bridge-owned provider entries in OpenCode, Pi, and Hermes and preserves the rest of each file. The last successful catalog is cached at `~/.config/modelferry/catalog.json`, so temporary Cursor API failures do not make existing models unavailable.

```sh
npm run models   # list cached models and native variants
npm run agents   # rescan installed agent harnesses and show setup status
npm run refresh  # refresh immediately and synchronize configured clients
npm run status
npm test
```

An already-running client may need its model picker reloaded before newly added models appear.

For clients without native variant support, the bridge understands deterministic `model@variant` identifiers. Pi and Hermes receive these aliases automatically. To also add them to OpenCode's model picker, set `"exposeVariantAliases": true` in `~/.config/modelferry/config.json` and run `npm run refresh`. This is disabled for OpenCode by default because it can add hundreds of entries.

### System prompts

Cursor's agent applies its own system prompt on every run, so the bridge excludes the outer client's system message by default to avoid sending the model two competing prompts. Recognized `<available_skills>` blocks and `Instructions from:` project guidance (including AGENTS.md) are preserved. To send the full outer system message through instead, set `"stripSystemPrompt": false` in `~/.config/modelferry/config.json`. The setup page at `http://127.0.0.1:8791/onboard` exposes this as a toggle, so you can flip it without editing the config file.

### Cache-friendly turns

Agentic loops (user → tools → answer) stay on **one** Cursor Agent run. When the model calls a client tool, Ferry returns `tool_calls` to the originating client but keeps the Cursor run alive until that client posts the tool result on the next `/v1/chat/completions` request. That avoids re-seeding the full transcript on every tool hop.

Sticky session routing uses standard and OpenCode cache-affinity signals when present:

- `X-Session-Id` / `x-session-id`
- `x-session-affinity`
- legacy `x-opencode-session` / `x-opencode-session-id`
- body `prompt_cache_key` when the client sends it

Sub-agent parent correlation is recorded from `x-parent-session-id` but does not replace the child session id.

On startup Ferry probes whether local `Agent.send()` retains conversation across turns (`npm run probe:retention`). If retention works, follow-up user messages on the same sticky session can send a delta-only prompt; otherwise each new user turn uses a cache-stable full seed. Tool hops inside a loop still use in-flight resume either way.

## Security

Model Ferry stores no Cursor credentials of its own. The Cursor SDK persists the browser login's minted API key to `~/.cursor/sdk/auth.json`, readable only by your user.

The HTTP API binds to `127.0.0.1` by default. First setup mints a random bearer token into `~/.config/modelferry/config.json` and writes it into each configured client's Model Ferry provider. Chat, models, catalog refresh, and setup-page login, logout, and config routes all require that token. Cursor agents created by the bridge are limited to MCP tools (`tools: ["mcp"]`), so the originating client keeps ownership of shell and file actions.

## Scope

The bridge implements `/health`, `/v1/models`, `/v1/catalog/refresh`, and streaming/non-streaming `/v1/chat/completions`. Client function tools are exposed to Cursor agents through a temporary MCP server and returned to the originating client for execution.

The catalog reflects models available to the Cursor API key. Cursor subscription limits, model eligibility, and usage accounting still apply.

### OpenCode 2.0

Ferry writes both config shapes so V1 and the OpenCode 2.0 beta (`opencode2` / `@opencode-ai/cli@next`) can select Cursor models:

| OpenCode | Config key | Package |
| --- | --- | --- |
| 1.x | `provider.cursorapi` | `@ai-sdk/openai-compatible` |
| 2.0 | `providers.cursorapi` | `@opencode-ai/ai/providers/openai-compatible` |

V2 model metadata uses `capabilities.tools` / `capabilities.input` / `capabilities.output` and array `variants` with `settings.cursor_params`. OpenCode 2 still accepts the V1 provider block; writing both keeps either CLI working after `modelferry refresh`.
