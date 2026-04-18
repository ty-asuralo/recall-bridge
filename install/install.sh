#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── prereqs: node ─────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  cat >&2 <<'EOM'
error: node not found on PATH. Install Node 20+ first:
  macOS:  brew install node
  Linux:  see https://nodejs.org/en/download/package-manager
EOM
  exit 1
fi

# ── build the bridge binary ───────────────────────────────────────────────────
if [[ ! -f "$REPO_DIR/dist/index.js" ]]; then
  echo "Building recall-bridge..."
  (cd "$REPO_DIR" && npm install && npm run build)
fi

SHIM="$REPO_DIR/bin/recall-bridge"
mkdir -p "$REPO_DIR/bin"
cat >"$SHIM" <<'SHIMEOF'
#!/usr/bin/env bash
# Chrome doesn't inherit the user's shell PATH — add common binary locations
for d in "$HOME/.local/bin" "$HOME/.bun/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
  [[ -d "$d" ]] && export PATH="$d:$PATH"
done
for d in "$HOME"/Library/Python/*/bin; do
  [[ -d "$d" ]] && export PATH="$d:$PATH"
done
SHIMEOF
# Append the exec line with resolved paths (not single-quoted)
cat >>"$SHIM" <<EOF
exec "$NODE_BIN" "$REPO_DIR/dist/index.js" "\$@"
EOF
chmod +x "$SHIM"

# ── write native messaging host manifest ─────────────────────────────────────
case "$(uname -s)" in
  Darwin) HOST_DIRS=("$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "$HOME/Library/Application Support/Chromium/NativeMessagingHosts") ;;
  Linux)  HOST_DIRS=("$HOME/.config/google-chrome/NativeMessagingHosts" "$HOME/.config/chromium/NativeMessagingHosts") ;;
  *) echo "error: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

EXTENSION_ID="${RECALL_EXTENSION_ID:-}"
if [[ -z "$EXTENSION_ID" ]]; then
  read -rp "Chrome extension ID for Recall (leave empty to fill in later): " EXTENSION_ID
fi
EXTENSION_ID="${EXTENSION_ID:-PLACEHOLDER_EXTENSION_ID}"

MANIFEST=$(cat "$REPO_DIR/install/com.recall.bridge.json")
MANIFEST="${MANIFEST//PLACEHOLDER_BINARY_PATH/$SHIM}"
MANIFEST="${MANIFEST//PLACEHOLDER_EXTENSION_ID/$EXTENSION_ID}"

for dir in "${HOST_DIRS[@]}"; do
  mkdir -p "$dir"
  printf '%s\n' "$MANIFEST" > "$dir/com.recall.bridge.json"
  echo "wrote $dir/com.recall.bridge.json"
done

# ── backend selection + bootstrap ─────────────────────────────────────────────
confirm() {
  local prompt="$1"
  read -rp "$prompt [y/N] " yn
  case "$yn" in [yY]*) return 0 ;; *) return 1 ;; esac
}

bootstrap_mempalace() {
  if command -v mempalace >/dev/null 2>&1; then
    echo "mempalace already installed: $(mempalace --version 2>&1 | head -1)"
    return 0
  fi

  echo
  echo "MemPalace (Python) is not installed."

  if ! command -v python3 >/dev/null 2>&1; then
    cat >&2 <<'EOM'
error: python3 not found. Install Python 3.9+ first:
  macOS:  brew install python
  Linux:  sudo apt install python3 python3-pip   (or your distro equivalent)
Then re-run this installer.
EOM
    exit 1
  fi

  local cmd
  if command -v pipx >/dev/null 2>&1; then
    cmd="pipx install mempalace"
  elif command -v pip3 >/dev/null 2>&1; then
    cmd="pip3 install --user mempalace"
  else
    cat >&2 <<'EOM'
error: neither pipx nor pip3 found. Install pipx first:
  macOS:  brew install pipx
  Linux:  sudo apt install pipx   (or: python3 -m pip install --user pipx)
Then re-run this installer.
EOM
    exit 1
  fi

  echo "Proposed install command:"
  echo "    $cmd"
  if ! confirm "Proceed?"; then
    echo "Skipped. Either re-run and choose Mock, or install MemPalace manually." >&2
    exit 1
  fi

  eval "$cmd" || { echo "error: MemPalace install failed" >&2; exit 1; }

  if ! command -v mempalace >/dev/null 2>&1; then
    cat >&2 <<'EOM'
MemPalace installed but 'mempalace' is not on PATH.
If you used pip --user, add ~/.local/bin to PATH:
  export PATH="$HOME/.local/bin:$PATH"
Add that line to your shell rc and re-run this installer.
EOM
    exit 1
  fi

  echo "mempalace installed: $(mempalace --version 2>&1 | head -1)"
}

bootstrap_gbrain() {
  if command -v gbrain >/dev/null 2>&1; then
    echo "gbrain already installed: $(gbrain --version 2>&1 | head -1)"
    return 0
  fi

  echo
  echo "GBrain (TypeScript, via Bun) is not installed."

  if ! command -v bun >/dev/null 2>&1; then
    cat >&2 <<'EOM'
error: bun not found. Install the Bun runtime first:
  curl -fsSL https://bun.sh/install | bash
Then restart your shell (or 'source ~/.bashrc' / '~/.zshrc') and re-run this installer.
EOM
    exit 1
  fi

  local cmd="bun add -g github:garrytan/gbrain"
  echo "Proposed install command:"
  echo "    $cmd"
  if ! confirm "Proceed?"; then
    echo "Skipped. Either re-run and choose Mock, or install GBrain manually." >&2
    exit 1
  fi

  $cmd || { echo "error: GBrain install failed" >&2; exit 1; }

  if ! command -v gbrain >/dev/null 2>&1; then
    cat >&2 <<'EOM'
GBrain installed but 'gbrain' is not on PATH.
Bun installs globals under ~/.bun/bin — add it to PATH:
  export PATH="$HOME/.bun/bin:$PATH"
Add that line to your shell rc and re-run this installer.
EOM
    exit 1
  fi

  echo "gbrain installed: $(gbrain --version 2>&1 | head -1)"
}

echo
echo "Select retrieval backend:"
echo "  1) MemPalace   (Python, auto-installs via pipx)"
echo "  2) GBrain      (TypeScript, auto-installs via Bun)"
echo "  3) Mock        (no external tool, canned results)"
read -rp "Choice [1-3]: " CHOICE
case "$CHOICE" in
  1) BACKEND="mempalace"; bootstrap_mempalace ;;
  2) BACKEND="gbrain"; bootstrap_gbrain ;;
  *) BACKEND="mock"; echo "Using mock backend." ;;
esac

# ── write bridge config ───────────────────────────────────────────────────────
read -rp "Absolute path to Recall raw export dir: " EXPORT_DIR
EXPORT_DIR="${EXPORT_DIR/#\~/$HOME}"

CONFIG_DIR="$HOME/.config/recall-bridge"
mkdir -p "$CONFIG_DIR"
cat >"$CONFIG_DIR/config.json" <<EOF
{
  "version": 1,
  "backend": "$BACKEND",
  "exportDir": "$EXPORT_DIR",
  "lastIngestedAt": 0
}
EOF
echo "wrote $CONFIG_DIR/config.json"
echo
echo "Install complete. Reload the Recall extension in chrome://extensions."
