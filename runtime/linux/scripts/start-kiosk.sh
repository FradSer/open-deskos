#!/usr/bin/env bash
# Kiosk entry point referenced by the autostart .desktop file.
# Keeps the shell running across crashes and appends all output to a log
# under ~/.local/state/open-deskos-shell/.
set -uo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null && pwd -P)"
SOURCE_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." >/dev/null && pwd -P)"
RUNTIME_ROOT="${ODK_RUNTIME_ROOT:-/opt/open-deskos}"
ACTIVE_RELEASE="${RUNTIME_ROOT}/current"
if [ -d "${ACTIVE_RELEASE}" ]; then
  DIR="$(CDPATH= cd -- "${ACTIVE_RELEASE}" >/dev/null && pwd -P)"
else
  DIR="${SOURCE_DIR}"
fi
cd "$DIR"

LOG_DIR="${HOME}/.local/state/open-deskos-shell"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/launcher.log"
PROFILE_DIR="${HOME}/.config/@fradser/open-deskos-linux-shell"

export ODESK_SHELL_KIOSK=1
# Runtime releases are sealed after preflight; their generated stylesheet is
# already part of the release and must not be rewritten during kiosk launch.
export ODESK_SKIP_STYLE_BUILD=1
# Enable hardware GPU acceleration by default; allow explicit software fallback.
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-0}"
export ELECTRON_EXTRA_LAUNCH_ARGS="${ELECTRON_EXTRA_LAUNCH_ARGS:-}"

# The CM5's X11 session enables DPMS by default. Kiosk is an always-on panel,
# so prevent the compositor from powering the HDMI output down while idle.
if [ -n "${DISPLAY:-}" ] && command -v xset >/dev/null 2>&1; then
  xset -dpms >/dev/null 2>&1 || true
  xset s off >/dev/null 2>&1 || true
  xset s noblank >/dev/null 2>&1 || true
fi

if [ -n "${DISPLAY:-}" ] && command -v openbox >/dev/null 2>&1; then
  openbox --reconfigure >/dev/null 2>&1 || true
fi

if [ -n "${DISPLAY:-}" ] && command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.1 -root >/dev/null 2>&1 &
fi

while true; do
  rm -f "${PROFILE_DIR}/SingletonLock" "${PROFILE_DIR}/SingletonCookie" "${PROFILE_DIR}/SingletonSocket"
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') starting kiosk shell from ${DIR}" >> "$LOG"
  ./run.sh --kiosk ${ELECTRON_EXTRA_LAUNCH_ARGS} >> "$LOG" 2>&1
  code=$?
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') shell exited (code ${code}); restarting in 3s" >> "$LOG"
  sleep 3
done
