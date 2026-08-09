#!/usr/bin/env bash
# Model Ferry installer
#   Quick install:  curl -fsSL https://ferry.designxdevelop.com/install.sh | bash
#   Local:          bash install.sh
# Clones the repo into $MODELFERRY_DIR (default ~/.modelferry), installs
# dependencies, and runs setup (signs in with Cursor, installs the background
# service, and syncs the Cursor catalog into OpenCode).

set -euo pipefail

REPO_URL="https://github.com/designxdevelop/model-ferry.git"
INSTALL_DIR="${MODELFERRY_DIR:-$HOME/.modelferry}"
BIN_DIR="${MODELFERRY_BIN_DIR:-$HOME/.local/bin}"
MIN_NODE_MAJOR=22

say() { printf '\033[1;34mmodelferry\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mmodelferry: error:\033[0m %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) SERVICE_MANAGER="launchd" ;;
  Linux)
    SERVICE_MANAGER="systemd"
    command -v systemctl >/dev/null 2>&1 || die "systemctl is required on Linux. Install systemd or run Model Ferry manually with npm start."
    ;;
  *) die "Model Ferry supports macOS and Linux." ;;
esac

command -v git >/dev/null 2>&1 || die "git is required. Install it from https://git-scm.com and re-run."
command -v node >/dev/null 2>&1 || die "Node.js >= 22 is required. Install it from https://nodejs.org and re-run."
command -v npm >/dev/null 2>&1 || die "npm is required. Install Node.js >= 22 from https://nodejs.org and re-run."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ] || die "Node.js >= 22 is required (found v$NODE_MAJOR.x). Re-run after upgrading."

if [ -d "$INSTALL_DIR" ]; then
  [ -d "$INSTALL_DIR/.git" ] || die "$INSTALL_DIR already exists and is not a Model Ferry checkout. Remove it or set MODELFERRY_DIR, then re-run."
  say "Updating existing install in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  say "Cloning Model Ferry into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

say "Installing dependencies"
(cd "$INSTALL_DIR" && npm install)

say "Linking modelferry onto your PATH"
mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/src/cli.mjs" "$BIN_DIR/modelferry"
chmod +x "$INSTALL_DIR/src/cli.mjs"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    say "Add $BIN_DIR to your PATH (for example: echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc)"
    ;;
esac

say "Running setup with $SERVICE_MANAGER — a browser window may open for Cursor sign-in"
(cd "$INSTALL_DIR" && npm run setup)

cat <<EOF

modelferry: installed. Next steps:
  1. Start or reload OpenCode.
  2. Pick the Cursor provider, then choose a model and a variant.
  3. Run \`modelferry status\` (or \`cd $INSTALL_DIR && npm run status\`) to check auth and bridge health.
EOF
