#!/usr/bin/env sh
# Spore Code — npm/npx installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.sh | sh
#
# Optional overrides:
#   SPORE_CODE_SOURCE=auto                   auto, local, github, or npm
#   SPORE_CODE_REF=work/spore-code-20260513  GitHub branch/tag for unpublished beta
#   SPORE_CODE_VERSION=beta                  npm dist-tag/version when source=npm
#   SPORE_CODE_PACKAGE=@vibe-coalition/spore-code
#   SPORE_CODE_PREFIX="$HOME/.local/share/spore-code-npm"
#
# Re-running upgrades the npm package in place.

set -eu

PACKAGE="${SPORE_CODE_PACKAGE:-@vibe-coalition/spore-code}"
VERSION="${SPORE_CODE_VERSION:-beta}"
REF="${SPORE_CODE_REF:-work/spore-code-20260513}"
SOURCE="${SPORE_CODE_SOURCE:-auto}"
PREFIX="${SPORE_CODE_PREFIX:-}"
BIN="spore"
MIN_NODE_MAJOR=22
REPO="Vibe-Coalition/spore-code"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd -P || pwd)"

if [ -t 1 ]; then
  C_BOLD="$(printf '\033[1m')"
  C_DIM="$(printf '\033[2m')"
  C_RED="$(printf '\033[31m')"
  C_GREEN="$(printf '\033[32m')"
  C_BLUE="$(printf '\033[34m')"
  C_RESET="$(printf '\033[0m')"
else
  C_BOLD="" C_DIM="" C_RED="" C_GREEN="" C_BLUE="" C_RESET=""
fi

say()  { printf "%s%s%s\n" "$C_BLUE" "-> $*" "$C_RESET"; }
ok()   { printf "%s%s%s\n" "$C_GREEN" "OK $*" "$C_RESET"; }
hint() { printf "%s%s%s\n" "$C_DIM"   "   $*" "$C_RESET"; }
die()  { printf "%s%s%s\n" "$C_RED"   "ERR $*" "$C_RESET" >&2; exit 1; }

os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
case "$os" in
  linux|darwin) ;;
  msys*|mingw*|cygwin*)
    die "Detected Windows shell. Use PowerShell: irm https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.ps1 | iex" ;;
  *) die "Unsupported OS: $os" ;;
esac

command -v node >/dev/null 2>&1 || die "Node.js $MIN_NODE_MAJOR+ is required. Install it from https://nodejs.org/ and rerun this installer."
command -v npm >/dev/null 2>&1 || die "npm is required but was not found on PATH."

node_major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
  die "Node.js $MIN_NODE_MAJOR+ is required; found $(node --version)."
fi

case "$SOURCE" in
  auto)
    if [ -f "$SCRIPT_DIR/package.json" ] && grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$PACKAGE\"" "$SCRIPT_DIR/package.json" 2>/dev/null; then
      SOURCE="local"
    else
      SOURCE="github"
    fi
    ;;
  local|github|npm) ;;
  *) die "Unsupported SPORE_CODE_SOURCE=$SOURCE. Use auto, local, github, or npm." ;;
esac

case "$SOURCE" in
  local)
    [ -f "$SCRIPT_DIR/package.json" ] || die "Local install requested, but package.json was not found next to install.sh."
    SPEC="$SCRIPT_DIR"
    ;;
  github)
    SPEC="https://github.com/$REPO/archive/refs/heads/$REF.tar.gz"
    ;;
  npm)
    if [ -n "$VERSION" ]; then SPEC="$PACKAGE@$VERSION"; else SPEC="$PACKAGE"; fi
    ;;
esac

NPM_ARGS="install -g"
if [ -n "$PREFIX" ]; then
  mkdir -p "$PREFIX" || die "Cannot create prefix $PREFIX"
  NPM_ARGS="$NPM_ARGS --prefix $PREFIX"
fi

say "Installing ${C_BOLD}$SPEC${C_RESET} with npm"
if [ "$SOURCE" = "github" ]; then
  hint "Using GitHub branch fallback because the npm beta may not be published yet."
fi
# shellcheck disable=SC2086
npm $NPM_ARGS "$SPEC" || die "npm install failed"

if [ -n "$PREFIX" ]; then
  BIN_DIR="$PREFIX/bin"
else
  npm_prefix="$(npm prefix -g 2>/dev/null || true)"
  BIN_DIR="${npm_prefix%/}/bin"
fi

if command -v "$BIN" >/dev/null 2>&1; then
  INSTALLED_BIN="$(command -v "$BIN")"
  ok "Installed $BIN at $INSTALLED_BIN"
else
  ok "Installed package"
  if [ -n "$BIN_DIR" ]; then
    hint "$BIN_DIR is where npm should place the spore command."
    case ":$PATH:" in
      *":$BIN_DIR:"*) ;;
      *)
        hint "$BIN_DIR is not in PATH."
        case "${SHELL##*/}" in
          bash) rc="~/.bashrc" ;;
          zsh)  rc="~/.zshrc" ;;
          fish) rc="~/.config/fish/config.fish" ;;
          *)    rc="your shell rc" ;;
        esac
        hint "Add this to $rc and reopen the shell:"
        hint "  export PATH=\"$BIN_DIR:\$PATH\""
        ;;
    esac
  fi
fi

if command -v "$BIN" >/dev/null 2>&1; then
  "$BIN" --version || true
fi

printf "\n%sRun %sspore setup%s to connect to Spore Core, then %sspore%s in a project directory.%s\n" \
  "$C_DIM" "$C_BOLD" "$C_RESET$C_DIM" "$C_BOLD" "$C_RESET$C_DIM" "$C_RESET"
