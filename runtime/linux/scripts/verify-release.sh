#!/usr/bin/env bash
set -euo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

SMOKE=(env ODESK_SKIP_STYLE_BUILD=1 ./run.sh --smoke)
if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  exec "${SMOKE[@]}"
fi

SESSION_ID="$(loginctl list-sessions --no-legend 2>/dev/null | awk -v user="$(id -un)" '$3 == user && $2 >= 1000 { print $1; exit }')"
SESSION_DISPLAY="$(loginctl show-session "${SESSION_ID}" -p Display --value 2>/dev/null || true)"
if [ -n "${SESSION_DISPLAY}" ]; then
  exec env DISPLAY="${SESSION_DISPLAY}" "${SMOKE[@]}"
fi

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 1920x1280x24" "${SMOKE[@]}"
fi

echo "release smoke needs a graphical session or xvfb-run" >&2
exit 1
