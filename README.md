# Model Ferry

Model Ferry is a persistent, loopback-only OpenAI-compatible adapter from OpenCode to Cursor's public Agent SDK. It discovers every model and parameter combination available to the configured Cursor API key and presents them as models and native variants in OpenCode.

It fixes two behaviors of API for Cursor:

- The bridge starts at login through `launchd`, so you don't get a Keychain unlock prompt after every restart. Authentication uses the Cursor SDK's stored browser login, or `CURSOR_API_KEY` when set.
- Its installer adds the `cursorapi` provider and synchronizes the authenticated Cursor model catalog without creating or changing OpenCode's top-level `model` setting.

## Install

```sh
npm install
npm run setup
```

The first time, `setup` signs you in with your Cursor account: a browser opens to complete a Cursor sign-in, and the SDK mints a 90-day API key stored at `~/.cursor/sdk/auth.json`. If you already have a Cursor API key, set `CURSOR_API_KEY` and run setup again — no browser login needed.

The setup command creates:

- `~/Library/LaunchAgents/ai.dxd.modelferry.plist`
- a `cursorapi` provider in `~/.config/opencode/opencode.json`

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

The bridge runs as a `launchd` launch agent, which does not inherit shell environment variables. A stored browser login works there out of the box; a `CURSOR_API_KEY` needs to be set for launchd too (`launchctl setenv CURSOR_API_KEY <key>`).

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

The bridge refreshes Cursor's catalog at startup and every six hours. It updates only `provider.cursorapi` in OpenCode's config and preserves the rest of the file. The last successful catalog is cached at `~/.config/modelferry/catalog.json`, so temporary Cursor API failures do not make existing models unavailable.

```sh
npm run models   # list cached models and native variants
npm run refresh  # refresh immediately and synchronize OpenCode
npm run status
npm test
```

OpenCode may need to be restarted or its configuration reloaded before newly added models appear in an already-running picker.

For clients without native variant support, the bridge also understands deterministic `model@variant` identifiers. Set `"exposeVariantAliases": true` in `~/.config/modelferry/config.json` and run `npm run refresh` to add those aliases to OpenCode's model picker. This is disabled by default because it can add hundreds of entries.

## Security

Model Ferry stores no Cursor credentials of its own. The Cursor SDK persists the browser login's minted API key to `~/.cursor/sdk/auth.json`, readable only by your user. The HTTP API binds only to `127.0.0.1` and requires a local bearer token.

## Scope

The bridge implements `/health`, `/v1/models`, `/v1/catalog/refresh`, and streaming/non-streaming `/v1/chat/completions`. OpenCode function tools are exposed to Cursor agents through a temporary MCP server and returned to OpenCode for execution.

The catalog reflects models available to the Cursor API key. Cursor subscription limits, model eligibility, and usage accounting still apply.
