#!/usr/bin/env bash
# Run ON the CM5 after first bring-up (also runs on any host for a dry report).
# Emits one JSON document of session/hardware/deployment evidence; paste the
# output into experiments/cm5-s31-gateway/README.md bring-up notes.
# Exit code is non-zero when any check fails.
set -uo pipefail

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
cd "$DIR"

NAMES=()
OKS=()
DETAILS=()
FAILURES=0

json_escape() {
  printf '%s' "$1" | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

check() { # name ok(bool) detail
  NAMES+=("$1")
  OKS+=("$2")
  DETAILS+=("$(json_escape "$3")")
  if [ "$2" != "true" ]; then
    FAILURES=$((FAILURES + 1))
  fi
}

ARCH="$(uname -m)"
check "arch" "$([ "$ARCH" = "aarch64" ] && echo true || echo false)" "uname -m: ${ARCH}"

if [ -r /etc/os-release ]; then
  . /etc/os-release
  check "os-release" "true" "${PRETTY_NAME:-${NAME:-unknown}}"
else
  check "os-release" "false" "/etc/os-release not readable"
fi

SESSION="${XDG_SESSION_TYPE:-unknown}"
SESSION_DETAIL="XDG_SESSION_TYPE=${SESSION}; DISPLAY=${DISPLAY:-unset}; WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset}"
case "$SESSION" in
  x11|wayland) check "session-type" "true" "$SESSION_DETAIL" ;;
  *) check "session-type" "false" "$SESSION_DETAIL" ;;
esac

MODE=""
if [ "$SESSION" = "x11" ] && command -v xrandr >/dev/null 2>&1; then
  MODE="$(xrandr --current 2>/dev/null | grep '\*' | head -n1 | awk '{print $1}')"
fi
if [ -n "$MODE" ]; then
  case "$MODE" in
    1920x1280|1280x1920) PANEL_OK="true" ;;
    *) PANEL_OK="false" ;;
  esac
  check "display-mode" "true" "active mode ${MODE}"
  check "panel-resolution" "$PANEL_OK" "active mode ${MODE}; expected 1920x1280 or rotated 1280x1920"
else
  check "display-mode" "false" "no active mode detected (needs X11 + xrandr; record manually on Wayland)"
  check "panel-resolution" "false" "undetected"
fi

if command -v glxinfo >/dev/null 2>&1; then
  RENDERER="$(glxinfo -B 2>/dev/null | grep 'OpenGL renderer' | head -n1 | cut -d: -f2- | sed 's/^ *//')"
  if [ -n "$RENDERER" ]; then
    check "gpu-renderer" "true" "$RENDERER"
  else
    check "gpu-renderer" "false" "glxinfo produced no renderer line"
  fi
else
  check "gpu-renderer" "false" "glxinfo not installed (mesa-utils); record manually"
fi

TOUCH="$(grep -iE 'Name=.*(touch|gt911|goodix|ilitek|elan)' /proc/bus/input/devices 2>/dev/null | sed 's/.*Name="//; s/"$//' | tr '\n' ';' )"
if [ -n "$TOUCH" ]; then
  check "touch-devices" "true" "$(printf '%s' "$TOUCH" | sed 's/;$//')"
else
  check "touch-devices" "false" "no touch-named evdev device in /proc/bus/input/devices"
fi

ELECTRON_BIN="./node_modules/.bin/electron"
if [ -x "$ELECTRON_BIN" ]; then
  EV="$("$ELECTRON_BIN" --version 2>/dev/null || true)"
  if [ -n "$EV" ]; then
    check "electron-version" "true" "$EV on $(uname -m)"
  else
    check "electron-version" "false" "electron binary did not report a version"
  fi

  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if command -v timeout >/dev/null 2>&1; then
      SMOKE="$(timeout 60 ./run.sh --smoke 2>/dev/null | tail -n1 || true)"
    else
      SMOKE="$(./run.sh --smoke 2>/dev/null | tail -n1 || true)"
    fi
    case "$SMOKE" in
      *'"ok":true'*) check "smoke-run" "true" "$SMOKE" ;;
      *) check "smoke-run" "false" "${SMOKE:-no output}" ;;
    esac
  else
    check "smoke-run" "false" "skipped: no display server in this session"
  fi

  ELECTRON_DIST="node_modules/electron/dist/electron"
  if [ -f "$ELECTRON_DIST" ]; then
    MISSING_LIBS="$(ldd "$ELECTRON_DIST" 2>/dev/null | grep 'not found' | awk '{print $1}' | sort -u | paste -sd, -)"
    if [ -z "$MISSING_LIBS" ]; then
      check "shared-libs-complete" "true" "ldd resolves all shared libraries"
    else
      check "shared-libs-complete" "false" "unresolved shared libs: ${MISSING_LIBS}"
    fi
  else
    check "shared-libs-complete" "false" "electron dist binary not found at ${ELECTRON_DIST}"
  fi
else
  check "electron-version" "false" "node_modules/.bin/electron missing; run scripts/cm5-install.sh first"
  check "shared-libs-complete" "false" "skipped: electron not installed"
  check "smoke-run" "false" "skipped: electron not installed"
fi

DESKTOP_FILE="${HOME}/.config/autostart/open-deskos-shell.desktop"
if [ -f "$DESKTOP_FILE" ] && grep -q "start-kiosk.sh" "$DESKTOP_FILE"; then
  check "autostart-entry" "true" "$DESKTOP_FILE points at scripts/start-kiosk.sh"
else
  check "autostart-entry" "false" "$DESKTOP_FILE missing or does not reference start-kiosk.sh"
fi

MEM_TOTAL="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
MEM_AVAIL="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
check "memory-mb" "true" "total ${MEM_TOTAL:-unknown} MB, available ${MEM_AVAIL:-unknown} MB (informational)"

printf '{\n  "generated_at": "%s",\n  "failures": %s,\n  "checks": [\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$FAILURES"
LAST=$(( ${#NAMES[@]} - 1 ))
for i in "${!NAMES[@]}"; do
  COMMA=","
  [ "$i" -eq "$LAST" ] && COMMA=""
  printf '    {"name": "%s", "ok": %s, "detail": "%s"}%s\n' \
    "$(json_escape "${NAMES[$i]}")" "${OKS[$i]}" "${DETAILS[$i]}" "$COMMA"
done
printf '  ]\n}\n'

[ "$FAILURES" -eq 0 ]
