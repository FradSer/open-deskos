#!/usr/bin/env bash
set -euo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null && pwd -P)"
cd "$DIR"

if [ ! -x node_modules/.bin/electron ] || [ ! -x node_modules/.bin/unocss ]; then
  echo "dependencies not installed; run: pnpm install (or npm install)" >&2
  exit 1
fi

if [ "${ODESK_SKIP_STYLE_BUILD:-0}" != "1" ]; then
  ./node_modules/.bin/unocss "src/renderer/**/*.html" "src/renderer/**/*.js" \
    -c uno.config.mjs -o src/renderer/uno.css --minify >/dev/null
fi

ARGS=("$@")
USER_ARGS="${ARGS[*]+${ARGS[*]}}"
if [ -n "${WAYLAND_DISPLAY:-}" ] && [[ "$USER_ARGS" != *--ozone-platform-hint* ]]; then
  ARGS+=(--ozone-platform-hint=auto)
fi
# Chromium refuses to run as root without --no-sandbox; SBC kiosk sessions
# often boot as root.
if [ "$(id -u)" = "0" ] && [[ "$USER_ARGS" != *--no-sandbox* ]]; then
  ARGS+=(--no-sandbox)
fi

if [ "${#ARGS[@]}" -gt 0 ]; then
  exec ./node_modules/.bin/electron . "${ARGS[@]}"
else
  exec ./node_modules/.bin/electron .
fi
