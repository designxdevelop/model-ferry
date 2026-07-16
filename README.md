# Composer Bridge

Composer Bridge is a persistent, loopback-only OpenAI-compatible adapter from OpenCode to Cursor's public local Agent SDK.

It fixes two behaviors of API for Cursor:

- The bridge starts at login through `launchd` and reads a mode-`0600` credential file, so it does not ask to unlock a Keychain item after every restart.
- Its installer adds the `cursorapi` provider and Composer models without creating or changing OpenCode's top-level `model` setting.

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

Start OpenCode normally and choose `cursorapi/composer-2.5` or `cursorapi/composer-2.5-fast` for a session. Other sessions continue to use your existing default model.

```sh
npm run status
npm test
```

## Security tradeoff

The Cursor API key is stored as plaintext readable only by your macOS user (`0600`). This deliberately avoids Keychain authorization prompts for a background launch agent. The HTTP API binds only to `127.0.0.1` and requires a local bearer token.

## Scope

The bridge implements the endpoints OpenCode needs: `/health`, `/v1/models`, and streaming/non-streaming `/v1/chat/completions`. OpenCode function tools are exposed to Composer through a temporary MCP server and returned to OpenCode for execution.
