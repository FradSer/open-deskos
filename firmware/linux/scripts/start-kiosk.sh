#!/usr/bin/env bash
# Kiosk entry point referenced by the autostart .desktop file.
# Keeps the shell running across crashes and appends all output to a log
# under ~/.local/state/open-deskos-shell/.
set -uo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

LOG_DIR="${HOME}/.local/state/open-deskos-shell"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/launcher.log"

export ODESK_SHELL_KIOSK=1

while true; do
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') starting kiosk shell" >> "$LOG"
  ./run.sh --kiosk >> "$LOG" 2>&1
  code=$?
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') shell exited (code ${code}); restarting in 3s" >> "$LOG"
  sleep 3
done
