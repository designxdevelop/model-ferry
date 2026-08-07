# Composer Bridge

Composer Bridge is a persistent, loopback-only OpenAI-compatible adapter from OpenCode to Cursor's public Agent SDK. It discovers every model and parameter combination available to the configured Cursor API key and presents them as models and native variants in OpenCode.

It fixes two behaviors of API for Cursor:

- The bridge starts at login through `launchd` and reads a mode-`0600` credential file, so it does not ask to unlock a Keychain item after every restart.
- Its installer adds the `cursorapi` provider and synchronizes the authenticated Cursor model catalog without creating or changing OpenCode's top-level `model` setting.

## Install

Keep API for Cursor unlocked for the one-time key migration, then run:

```sh
npm install
npm run setup
```

The setup command creates:

- `~/.config/cursor-composer-bridge/credentials` (`0600`)
- `~/Library/LaunchAgents/ai.dxd.cursor-composer-bridge.plist`
- a `cursorapi` provider in `~/.config/opencode/opencode.json`

It backs up the OpenCode config before changing it and preserves the existing default model exactly.

## Use

Start OpenCode normally, choose the **Cursor Models** provider, then select any available model. OpenCode's variant selector (or `ctrl+t`) switches between the exact thinking, reasoning, effort, context, and fast combinations advertised by Cursor.

From the CLI, pass a native variant preset with `--variant`:

```sh
opencode run -m cursorapi/gpt-5.6-sol --variant 1m-high-standard "Explain this repository"
```

Variant names are generated from Cursor's canonical parameters. Only combinations explicitly returned by Cursor are offered.

## Catalog refresh

The bridge refreshes Cursor's catalog at startup and every six hours. It updates only `provider.cursorapi` in OpenCode's config and preserves the rest of the file. The last successful catalog is cached at `~/.config/cursor-composer-bridge/catalog.json`, so temporary Cursor API failures do not make existing models unavailable.

```sh
npm run models   # list cached models and native variants
npm run refresh  # refresh immediately and synchronize OpenCode
npm run status
npm test
```

OpenCode may need to be restarted or its configuration reloaded before newly added models appear in an already-running picker.

For clients without native variant support, the bridge also understands deterministic `model@variant` identifiers. Set `"exposeVariantAliases": true` in `~/.config/cursor-composer-bridge/config.json` and run `npm run refresh` to add those aliases to OpenCode's model picker. This is disabled by default because it can add hundreds of entries.

## Security tradeoff

The Cursor API key is stored as plaintext readable only by your macOS user (`0600`). This deliberately avoids Keychain authorization prompts for a background launch agent. The HTTP API binds only to `127.0.0.1` and requires a local bearer token.

## Scope

The bridge implements `/health`, `/v1/models`, `/v1/catalog/refresh`, and streaming/non-streaming `/v1/chat/completions`. OpenCode function tools are exposed to Cursor agents through a temporary MCP server and returned to OpenCode for execution.

The catalog reflects models available to the Cursor API key. Cursor subscription limits, model eligibility, and usage accounting still apply.
