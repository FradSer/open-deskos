#!/usr/bin/env bash
set -euo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

verify_in_session() {
  env -u ELECTRON_RUN_AS_NODE "${DIR}/node_modules/.bin/electron" "${DIR}/scripts/validate-runtime-dependencies.js" "${DIR}"
  exec env ODESK_SKIP_STYLE_BUILD=1 ./run.sh --smoke
}

if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || [ "$(uname -s)" = Darwin ]; then
  verify_in_session
fi

SESSION_ID="$(loginctl list-sessions --no-legend 2>/dev/null | awk -v user="$(id -un)" '$3 == user && $2 >= 1000 { print $1; exit }')"
SESSION_DISPLAY="$(loginctl show-session "${SESSION_ID}" -p Display --value 2>/dev/null || true)"
if [ -n "${SESSION_DISPLAY}" ]; then
  export DISPLAY="${SESSION_DISPLAY}"
  verify_in_session
fi

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 1920x1280x24" bash "${DIR}/scripts/verify-release.sh"
fi

echo "release smoke needs a graphical session or xvfb-run" >&2
exit 1
