#!/usr/bin/env bash
# Run ON the CM5 (Debian/Ubuntu, arm64) inside the synced firmware/linux directory.
# Installs Electron runtime dependencies, installs node modules for arm64,
# and registers a kiosk autostart entry backed by scripts/start-kiosk.sh.
set -euo pipefail

if [ "$(uname -m)" != "aarch64" ]; then
  echo "This installer targets arm64 (CM5). Current arch: $(uname -m)" >&2
  exit 1
fi

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if ! command -v sudo >/dev/null 2>&1; then
    echo "This installer needs root privileges: run as root or install sudo." >&2
    exit 1
  fi
  SUDO="sudo"
fi

echo "== installing Electron runtime dependencies =="
$SUDO apt-get update
if ! $SUDO apt-get install -y libgtk-3-0 libnss3 libgbm1 libxss1 libasound2 2>/dev/null; then
  echo "retrying with libasound2t64 (Ubuntu 24.04 naming)"
  $SUDO apt-get install -y libgtk-3-0 libnss3 libgbm1 libxss1 libasound2t64
fi

echo "== installing node modules (downloads linux-arm64 Electron) =="
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile
else
  npm install
fi
SANDBOX_FLAG=""
if [ "$(id -u)" = "0" ]; then
  SANDBOX_FLAG="--no-sandbox"
fi
echo "electron $(./node_modules/.bin/electron --version $SANDBOX_FLAG 2>/dev/null || echo '?') on $(uname -m)"

echo "== registering kiosk autostart =="
AUTOSTART_DIR="${HOME}/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/open-deskos-shell.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Open DeskOS Shell
Exec="${DIR}/scripts/start-kiosk.sh"
X-GNOME-Autostart-enabled=true
Terminal=false
EOF

echo "done. reboot (or restart the session) to start the shell in kiosk mode."
echo "logs: ~/.local/state/open-deskos-shell/launcher.log"
echo "override resolution with ODESK_SHELL_WIDTH / ODESK_SHELL_HEIGHT in the environment."
