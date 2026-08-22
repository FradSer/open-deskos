#!/usr/bin/env bash
# Run ON the CM5 (Debian/Ubuntu, arm64) inside the synced firmware/linux directory.
# Installs Electron runtime dependencies, installs node modules for arm64,
# and registers a kiosk autostart entry.
set -euo pipefail

if [ "$(uname -m)" != "aarch64" ]; then
  echo "This installer targets arm64 (CM5). Current arch: $(uname -m)" >&2
  exit 1
fi

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

echo "== installing Electron runtime dependencies =="
if ! apt-get install -y libgtk-3-0 libnss3 libgbm1 libxss1 libasound2 2>/dev/null; then
  echo "retrying with libasound2t64 (Ubuntu 24.04 naming)"
  apt-get install -y libgtk-3-0 libnss3 libgbm1 libxss1 libasound2t64
fi

echo "== installing node modules (downloads linux-arm64 Electron) =="
if command -v pnpm >/dev/null 2>&1; then
  pnpm install
else
  npm install
fi

echo "== registering kiosk autostart =="
AUTOSTART_DIR="${HOME}/.config/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/open-deskos-shell.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Open DeskOS Shell
Exec=bash -lc 'cd "${DIR}" && ODESK_SHELL_KIOSK=1 ./run.sh --kiosk'
X-GNOME-Autostart-enabled=true
Terminal=false
EOF

echo "done. reboot (or restart the session) to start the shell in kiosk mode."
echo "override resolution with ODESK_SHELL_WIDTH / ODESK_SHELL_HEIGHT in the environment."
