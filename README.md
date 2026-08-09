# Model Ferry

Model Ferry is a persistent, loopback-only OpenAI-compatible adapter from OpenCode to Cursor's public Agent SDK. It discovers every model and parameter combination available to the configured Cursor API key and presents them as models and native variants in OpenCode.

It fixes two behaviors of API for Cursor:

- The bridge starts at login through `launchd` on macOS or a systemd user service on Linux. Authentication uses the Cursor SDK's stored browser login, or `CURSOR_API_KEY` when set.
- Its installer adds the `cursorapi` provider and synchronizes the authenticated Cursor model catalog without creating or changing OpenCode's top-level `model` setting.

## Install

**Quick install** — clones the repo to `~/.modelferry`, installs dependencies, and runs setup:

```sh
curl -fsSL https://ferry.designxdevelop.com/install.sh | bash
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
- a `cursorapi` provider in `~/.config/opencode/opencode.json` (V1 `provider.cursorapi` and OpenCode 2.0 `providers.cursorapi`)

It backs up the OpenCode config before changing it and preserves the existing default model exactly.

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

The bridge runs as a background service, which does not inherit shell environment variables. A stored browser login works there out of the box. To use `CURSOR_API_KEY`, set it for the service manager too: macOS uses `launchctl setenv CURSOR_API_KEY <key>`; on Linux, put `CURSOR_API_KEY=...` in `~/.config/environment.d/modelferry.conf`, then run `systemctl --user daemon-reload` and `systemctl --user restart ai.dxd.modelferry.service` (a one-shot `systemctl --user import-environment CURSOR_API_KEY` only lasts for the current user-manager session).

### Auto-renewal

Browser-login keys expire after 90 days. The bridge automatically re-runs the browser login and mints a fresh key when expiry is within the renewal window (3 days by default, `loginRenewMs` in `~/.config/modelferry/config.json`) — at startup, on its six-hour refresh cycle, and before a chat run that would otherwise use an expiring key. If renewal is missed and the key lapses, chat requests fail with HTTP `503` and error code `not_authenticated` (or `auth_renewal_failed` when a renewal attempt itself failed), with a message pointing to the setup page and `modelferry login`.

## Ports

The bridge listens on `127.0.0.1:8791` by default. If that port is already in use, it scans the next 19 ports and binds the first free one, then records the resolved port in `~/.config/modelferry/config.json` so the OpenCode provider `baseURL`, the onboarding page, and the CLI commands all agree on it.

## Use

Start OpenCode normally, choose the **Cursor** provider, then select any available model. OpenCode's variant selector (or `ctrl+t`) switches between the exact thinking, reasoning, effort, context, and fast combinations advertised by Cursor.

From the CLI, pass a native variant preset with `--variant`:

```sh
opencode run -m cursorapi/gpt-5.6-sol --variant 1m-high-standard "Explain this repository"
```

Variant names are generated from Cursor's canonical parameters. Only combinations explicitly returned by Cursor are offered.

## Catalog refresh

The bridge refreshes Cursor's catalog at startup and every six hours. It updates only the bridge-owned `cursorapi` entries in OpenCode's config (`provider.cursorapi` for V1 and `providers.cursorapi` for OpenCode 2.0) and preserves the rest of the file. The last successful catalog is cached at `~/.config/modelferry/catalog.json`, so temporary Cursor API failures do not make existing models unavailable.

```sh
npm run models   # list cached models and native variants
npm run refresh  # refresh immediately and synchronize OpenCode
npm run status
npm test
```

OpenCode may need to be restarted or its configuration reloaded before newly added models appear in an already-running picker.

For clients without native variant support, the bridge also understands deterministic `model@variant` identifiers. Set `"exposeVariantAliases": true` in `~/.config/modelferry/config.json` and run `npm run refresh` to add those aliases to OpenCode's model picker. This is disabled by default because it can add hundreds of entries.

### System prompts

Cursor's agent applies its own system prompt on every run, so the bridge excludes the outer client's system message by default to avoid sending the model two competing system prompts. The `<available_skills>` block and any `Instructions from:` project guidance (AGENTS.md) from the outer client are preserved so OpenCode skills and project rules stay visible to the Cursor agent. To send the full outer system message through instead, set `"stripSystemPrompt": false` in `~/.config/modelferry/config.json`. The setup page at `http://127.0.0.1:8791/onboard` exposes this as a toggle, so you can flip it without editing the config file.

### Cache-friendly turns

OpenCode agentic loops (user → tools → answer) stay on **one** Cursor Agent run. When the model calls an OpenCode tool, Ferry returns `tool_calls` to OpenCode but keeps the Cursor run alive and blocks the MCP call until OpenCode posts the tool result on the next `/v1/chat/completions` request. That avoids re-seeding the full transcript on every tool hop.

Sticky session routing uses OpenCode 2.0 cache-affinity headers when present:

- `X-Session-Id` / `x-session-id`
- `x-session-affinity`
- legacy `x-opencode-session` / `x-opencode-session-id`
- body `prompt_cache_key` when the client sends it

Sub-agent parent correlation is recorded from `x-parent-session-id` but does not replace the child session id.

On startup Ferry probes whether local `Agent.send()` retains conversation across turns (`npm run probe:retention`). If retention works, follow-up user messages on the same sticky session can send a delta-only prompt; otherwise each new user turn uses a cache-stable full seed. Tool hops inside a loop still use in-flight resume either way.

## Security

Model Ferry stores no Cursor credentials of its own. The Cursor SDK persists the browser login's minted API key to `~/.cursor/sdk/auth.json`, readable only by your user.

The HTTP API binds to `127.0.0.1` by default. First setup mints a random bearer token into `~/.config/modelferry/config.json` and writes it into OpenCode's `cursorapi` provider as `apiKey`. Chat, models, catalog refresh, and setup-page login, logout, and config routes all require that token. Cursor agents created by the bridge are limited to MCP tools (`tools: ["mcp"]`), so OpenCode keeps ownership of shell and file actions.

## Scope

The bridge implements `/health`, `/v1/models`, `/v1/catalog/refresh`, and streaming/non-streaming `/v1/chat/completions`. OpenCode function tools are exposed to Cursor agents through a temporary MCP server and returned to OpenCode for execution.

The catalog reflects models available to the Cursor API key. Cursor subscription limits, model eligibility, and usage accounting still apply.

### OpenCode 2.0

Ferry writes both config shapes so V1 and the OpenCode 2.0 beta (`opencode2` / `@opencode-ai/cli@next`) can select Cursor models:

| OpenCode | Config key | Package |
| --- | --- | --- |
| 1.x | `provider.cursorapi` | `@ai-sdk/openai-compatible` |
| 2.0 | `providers.cursorapi` | `@opencode-ai/ai/providers/openai-compatible` |

V2 model metadata uses `capabilities.tools` / `capabilities.input` / `capabilities.output` and array `variants` with `settings.cursor_params`. OpenCode 2 still accepts the V1 provider block; writing both keeps either CLI working after `modelferry refresh`.
