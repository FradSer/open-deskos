#!/usr/bin/env bash
# Run ON the CM5 after first bring-up (also runs on any host for a dry report).
# Emits one JSON document of release, service, session, and hardware evidence.
# Exit code is non-zero when a required base-shell check fails.
set -uo pipefail

SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
DIR="$SOURCE_DIR"
cd "$DIR"

NAMES=()
OKS=()
REQUIRED=()
CLASSES=()
DETAILS=()
FAILURES=0

json_escape() {
  printf '%s' "$1" | tr '\n' ' ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

check() { # name ok(bool) required(bool) class detail
  NAMES+=("$1")
  OKS+=("$2")
  REQUIRED+=("$3")
  CLASSES+=("$4")
  DETAILS+=("$(json_escape "$5")")
  if [ "$3" = "true" ] && [ "$2" != "true" ]; then
    FAILURES=$((FAILURES + 1))
  fi
}

release_evidence() {
  local root="${ODK_RUNTIME_ROOT:-/opt/open-deskos}"
  local current="${root}/current"
  local previous="${root}/previous"
  local state_file="${root}/state/runtime-state.json"
  if [ -L "$current" ] && [ -d "$current" ]; then
    ACTIVE_RUNTIME_DIR="$(readlink -f "$current")"
    local active
    active="$(basename "$ACTIVE_RUNTIME_DIR")"
    check "active-release" "true" "true" "runtime" "${active} via ${current}"
  else
    check "active-release" "false" "true" "runtime" "no active release pointer at ${current}"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    local kiosk_state kiosk_unit
    kiosk_state="$(systemctl --user is-active open-deskos-shell.service 2>/dev/null || true)"
    kiosk_unit="${HOME}/.config/systemd/user/open-deskos-shell.service"
    if [ "$kiosk_state" = "active" ] && [ -r "$kiosk_unit" ] && grep -q "${current}/scripts/start-kiosk.sh" "$kiosk_unit"; then
      check "kiosk-release-launcher" "true" "true" "runtime" "open-deskos-shell.service is active and resolves ${current} on restart"
    else
      check "kiosk-release-launcher" "false" "true" "runtime" "service=${kiosk_state:-unknown}; unit=${kiosk_unit}"
    fi
  else
    check "kiosk-release-launcher" "false" "true" "runtime" "systemctl is unavailable"
  fi
  if [ -L "$previous" ] && [ -d "$previous" ]; then
    check "rollback-release" "true" "false" "runtime" "$(basename "$(readlink -f "$previous")") via ${previous}"
  else
    check "rollback-release" "false" "false" "runtime" "no rollback release recorded"
  fi
  if [ -r "$state_file" ]; then
    check "runtime-update-state" "true" "false" "runtime" "$(tr '\n' ' ' < "$state_file")"
  else
    check "runtime-update-state" "false" "false" "runtime" "no recorded runtime update state"
  fi
  if [ -d "${root}/state/migrations" ]; then
    local markers
    markers="$(find "${root}/state/migrations" -name '*.done' -type f 2>/dev/null | wc -l | tr -d ' ')"
    check "runtime-migrations" "true" "false" "runtime" "${markers} completed user-scoped migration marker(s)"
  else
    check "runtime-migrations" "false" "false" "runtime" "no runtime migration markers"
  fi
}

service_evidence() {
  local unit="$1" required="$2" class="$3"
  if ! command -v systemctl >/dev/null 2>&1; then
    check "$unit" "false" "$required" "$class" "systemctl is unavailable"
    return
  fi
  local state
  state="$(systemctl --user is-active "$unit" 2>/dev/null || true)"
  case "$state" in
    active) check "$unit" "true" "$required" "$class" "systemd user service is active" ;;
    *) check "$unit" "false" "$required" "$class" "systemd user service state: ${state:-unknown}" ;;
  esac
}

release_evidence
if [ -n "${ACTIVE_RUNTIME_DIR:-}" ]; then
  DIR="$ACTIVE_RUNTIME_DIR"
  cd "$DIR"
fi

ARCH="$(uname -m)"
check "arch" "$([ "$ARCH" = "aarch64" ] && echo true || echo false)" "true" "hardware" "uname -m: ${ARCH}"

if [ -r /etc/os-release ]; then
  . /etc/os-release
  check "os-release" "true" "true" "hardware" "${PRETTY_NAME:-${NAME:-unknown}}"
else
  check "os-release" "false" "true" "hardware" "/etc/os-release not readable"
fi

SESSION="${XDG_SESSION_TYPE:-unknown}"
SESSION_DETAIL="XDG_SESSION_TYPE=${SESSION}; DISPLAY=${DISPLAY:-unset}; WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-unset}"
case "$SESSION" in
  x11|wayland) check "session-type" "true" "true" "hardware" "$SESSION_DETAIL" ;;
  *) check "session-type" "false" "true" "hardware" "$SESSION_DETAIL" ;;
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
  check "display-mode" "true" "true" "hardware" "active mode ${MODE}"
  check "panel-resolution" "$PANEL_OK" "true" "hardware" "active mode ${MODE}; expected 1920x1280 or rotated 1280x1920"
else
  check "display-mode" "false" "true" "hardware" "no active mode detected (needs X11 + xrandr; record manually on Wayland)"
  check "panel-resolution" "false" "true" "hardware" "undetected"
fi

if command -v glxinfo >/dev/null 2>&1; then
  RENDERER="$(glxinfo -B 2>/dev/null | grep 'OpenGL renderer' | head -n1 | cut -d: -f2- | sed 's/^ *//')"
  if [ -n "$RENDERER" ]; then
    check "gpu-renderer" "true" "true" "hardware" "$RENDERER"
  else
    check "gpu-renderer" "false" "true" "hardware" "glxinfo produced no renderer line"
  fi
else
  check "gpu-renderer" "false" "true" "hardware" "glxinfo not installed (mesa-utils); record manually"
fi

TOUCH="$(grep -iE 'Name=.*(touch|gt911|goodix|ilitek|elan)' /proc/bus/input/devices 2>/dev/null | sed 's/.*Name="//; s/"$//' | tr '\n' ';' )"
if [ -n "$TOUCH" ]; then
  check "touch-devices" "true" "true" "hardware" "$(printf '%s' "$TOUCH" | sed 's/;$//')"
else
  check "touch-devices" "false" "true" "hardware" "no touch-named evdev device in /proc/bus/input/devices"
fi

ELECTRON_BIN="./node_modules/.bin/electron"
if [ -x "$ELECTRON_BIN" ]; then
  EV="$("$ELECTRON_BIN" --version 2>/dev/null || true)"
  if [ -n "$EV" ]; then
    check "electron-version" "true" "true" "runtime" "$EV on $(uname -m)"
  else
    check "electron-version" "false" "true" "runtime" "electron binary did not report a version"
  fi

  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if command -v timeout >/dev/null 2>&1; then
      SMOKE="$(timeout 60 env ODESK_SKIP_STYLE_BUILD=1 ./run.sh --smoke 2>/dev/null | tail -n1 || true)"
    else
      SMOKE="$(env ODESK_SKIP_STYLE_BUILD=1 ./run.sh --smoke 2>/dev/null | tail -n1 || true)"
    fi
    case "$SMOKE" in
      *'"ok":true'*) check "smoke-run" "true" "true" "runtime" "$SMOKE" ;;
      *) check "smoke-run" "false" "true" "runtime" "${SMOKE:-no output}" ;;
    esac
  else
    check "smoke-run" "false" "true" "runtime" "skipped: no display server in this session"
  fi

  ELECTRON_DIST="node_modules/electron/dist/electron"
  if [ -f "$ELECTRON_DIST" ]; then
    MISSING_LIBS="$(ldd "$ELECTRON_DIST" 2>/dev/null | grep 'not found' | awk '{print $1}' | sort -u | paste -sd, -)"
    if [ -z "$MISSING_LIBS" ]; then
      check "shared-libs-complete" "true" "true" "runtime" "ldd resolves all shared libraries"
    else
      check "shared-libs-complete" "false" "true" "runtime" "unresolved shared libs: ${MISSING_LIBS}"
    fi
  else
    check "shared-libs-complete" "false" "true" "runtime" "electron dist binary not found at ${ELECTRON_DIST}"
  fi
else
  check "electron-version" "false" "true" "runtime" "node_modules/.bin/electron missing; run scripts/cm5-install.sh first"
  check "shared-libs-complete" "false" "true" "runtime" "skipped: electron not installed"
  check "smoke-run" "false" "true" "runtime" "skipped: electron not installed"
fi

DESKTOP_FILE="${HOME}/.config/autostart/open-deskos-shell.desktop"
if [ -r "$DESKTOP_FILE" ] && grep -q "import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY" "$DESKTOP_FILE"; then
  check "graphical-session-autostart" "true" "true" "runtime" "${DESKTOP_FILE} imports active display environment before restarting kiosk service"
else
  check "graphical-session-autostart" "false" "true" "runtime" "${DESKTOP_FILE} is missing or does not import display environment"
fi

service_evidence "open-deskos-shell.service" "true" "runtime"
if pgrep -u "$(id -u)" -f 'node_modules/.pnpm/electron.*--kiosk' >/dev/null 2>&1; then
  check "kiosk-process" "true" "true" "runtime" "active release Electron kiosk process is running"
else
  check "kiosk-process" "false" "true" "runtime" "no active Electron kiosk process found"
fi
service_evidence "open-deskos-remote-bridge.service" "false" "peripheral"
service_evidence "open-deskos-face-agent.service" "false" "experiment"

MEM_TOTAL="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
MEM_AVAIL="$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo 2>/dev/null)"
check "memory-mb" "true" "false" "informational" "total ${MEM_TOTAL:-unknown} MB, available ${MEM_AVAIL:-unknown} MB"

printf '{\n  "generated_at": "%s",\n  "failures": %s,\n  "checks": [\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$FAILURES"
LAST=$(( ${#NAMES[@]} - 1 ))
for i in "${!NAMES[@]}"; do
  COMMA=","; [ "$i" -eq "$LAST" ] && COMMA=""
  printf '    {"name": "%s", "ok": %s, "required": %s, "class": "%s", "detail": "%s"}%s\n' \
    "$(json_escape "${NAMES[$i]}")" "${OKS[$i]}" "${REQUIRED[$i]}" \
    "$(json_escape "${CLASSES[$i]}")" "${DETAILS[$i]}" "$COMMA"
done
printf '  ]\n}\n'

[ "$FAILURES" -eq 0 ]
