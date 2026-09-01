#!/usr/bin/env bash
# Run ON the CM5 (Debian/Ubuntu, arm64) inside the synced runtime/linux directory.
# Installs Electron runtime dependencies, installs node modules for arm64,
# and registers a kiosk autostart entry backed by scripts/start-kiosk.sh.
set -euo pipefail

if [ "$(uname -m)" != "aarch64" ]; then
  echo "This installer targets arm64 (CM5). Current arch: $(uname -m)" >&2
  exit 1
fi

DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"
REPOSITORY_ROOT="$(CDPATH= cd -- "${DIR}/../.." >/dev/null && pwd -P)"
FACE_AGENT_SOURCE="${REPOSITORY_ROOT}/experiments/vision/face-agent"
REMOTE_BRIDGE_SOURCE="${REPOSITORY_ROOT}/integrations/remote-bridge"
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
$SUDO apt-get update || echo "apt-get update failed; using cached package indexes" >&2
if ! $SUDO apt-get install -y libgtk-3-0 libnss3 libgbm1 libxss1 libasound2 unclutter mesa-utils libgl1-mesa-dri libegl1 libgles2 2>/dev/null; then
  echo "retrying with libasound2t64 (Ubuntu 24.04 naming)"
  $SUDO apt-get install -y libgtk-3-0 libnss3 libgbm1 libxss1 libasound2t64 unclutter mesa-utils libgl1-mesa-dri libegl1 libgles2
fi

FACE_AGENT_DIR="/opt/face-agent"
FACE_AGENT_VENV="/opt/face-agent-venv"

resolve_target_user() {
  if [ "$(id -u)" -ne 0 ]; then
    id -un
    return
  fi
  if [ -n "${SUDO_USER:-}" ] && id "${SUDO_USER}" >/dev/null 2>&1; then
    printf '%s\n' "${SUDO_USER}"
    return
  fi
  local session_user
  session_user="$(loginctl list-sessions --no-legend 2>/dev/null | awk '$2 >= 1000 { print $3; exit }')"
  if [ -n "${session_user}" ] && id "${session_user}" >/dev/null 2>&1; then
    printf '%s\n' "${session_user}"
    return
  fi
  getent passwd 1000 | cut -d: -f1
}

TARGET_USER="$(resolve_target_user)"
if [ -z "${TARGET_USER}" ]; then
  echo "Could not determine the graphical kiosk user; set SUDO_USER and retry." >&2
  exit 1
fi
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
TARGET_UID="$(id -u "${TARGET_USER}")"
TARGET_GID="$(id -g "${TARGET_USER}")"
FACE_AGENT_UNIT_DIR="${TARGET_HOME}/.config/systemd/user"

# Ensure target user has access to DRM/GPU render nodes (/dev/dri/card*, /dev/dri/renderD128)
for group in video render; do
  if getent group "$group" >/dev/null 2>&1; then
    $SUDO usermod -a -G "$group" "${TARGET_USER}" || true
  fi
done

run_as_target_user() {
  if [ "$(id -u)" -eq "${TARGET_UID}" ]; then
    "$@"
  else
    runuser -u "${TARGET_USER}" -- env \
      HOME="${TARGET_HOME}" \
      USER="${TARGET_USER}" \
      LOGNAME="${TARGET_USER}" \
      XDG_RUNTIME_DIR="/run/user/${TARGET_UID}" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${TARGET_UID}/bus" \
      DISPLAY="${DISPLAY:-}" \
      WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-}" \
      XAUTHORITY="${XAUTHORITY:-}" \
      PATH="${KIOSK_BIN:-${NODE_BIN:-/usr/local/bin}}:${NODE_BIN:-/usr/local/bin}:/usr/local/bin:/usr/bin:/bin" \
      COREPACK_ENABLE_PROJECT_SPEC=0 \
      "$@"
  fi
}

TARGET_NODE="$(runuser -u "${TARGET_USER}" -- env HOME="${TARGET_HOME}" PATH="/usr/local/bin:/usr/bin:/bin" sh -c 'command -v node')"
if [ -z "${TARGET_NODE}" ]; then
  echo "Could not locate Node for the kiosk user." >&2
  exit 1
fi
NODE_BIN="$(dirname "$(readlink -f "${TARGET_NODE}")")"
COREPACK_PNPM="${NODE_BIN}/corepack"
KIOSK_BIN="${TARGET_HOME}/.local/lib/open-deskos/bin"
$SUDO install -d -o "${TARGET_UID}" -g "${TARGET_GID}" -m 0755 "${KIOSK_BIN}"
cat <<EOF | $SUDO tee "${KIOSK_BIN}/pnpm" >/dev/null
#!/bin/sh
exec "${COREPACK_PNPM}" pnpm "\$@"
EOF
$SUDO chown "${TARGET_UID}:${TARGET_GID}" "${KIOSK_BIN}/pnpm"
$SUDO chmod 0755 "${KIOSK_BIN}/pnpm"

install_face_agent() {
  if [ ! -f "${FACE_AGENT_DIR}/face_service.py" ]; then
    echo "Face Agent source is missing at ${FACE_AGENT_DIR}; install it before running this installer." >&2
    return 1
  fi
  echo "== provisioning Face Agent =="
  $SUDO apt-get install -y python3-venv python3-aiohttp python3-serial
  if [ ! -x "${FACE_AGENT_VENV}/bin/python3" ]; then
    $SUDO python3 -m venv --system-site-packages "${FACE_AGENT_VENV}"
  fi
  $SUDO "${FACE_AGENT_VENV}/bin/pip" install --upgrade pyserial
  $SUDO install -o root -g root -m 0644 "${FACE_AGENT_SOURCE}/face_service.py" "${FACE_AGENT_DIR}/face_service.py"
  $SUDO chown -R "${TARGET_UID}:${TARGET_GID}" "${FACE_AGENT_DIR}/data"

  run_as_target_user mkdir -p "${FACE_AGENT_UNIT_DIR}"
  run_as_target_user install -m 0644 "${FACE_AGENT_SOURCE}/systemd/open-deskos-face-agent.service" \
    "${FACE_AGENT_UNIT_DIR}/open-deskos-face-agent.service"
  run_as_target_user systemctl --user daemon-reload
  run_as_target_user systemctl --user enable --now open-deskos-face-agent.service
}

install_experimental_vision() {
  install_face_agent

  echo "== configuring the experimental ESP32-P4 camera serial link =="
  # The P4 board's USB-UART bridge presents its console/metadata link as 1a86:55d3.
  $SUDO tee /etc/udev/rules.d/99-open-deskos-p4-camera.rules >/dev/null <<'EOF'
SUBSYSTEM=="tty", KERNEL=="ttyACM*", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d3", SYMLINK+="open-deskos-p4-camera", GROUP="dialout", MODE="0660"
EOF
  $SUDO udevadm control --reload-rules
  $SUDO udevadm trigger --subsystem-match=tty

  if [ ! -e /dev/open-deskos-p4-camera ]; then
    echo "ESP32-P4 camera serial adapter not detected yet; connect it and rerun udevadm trigger before starting the Face Agent." >&2
  fi
}

if [ "${ODESK_INSTALL_EXPERIMENTAL_VISION:-0}" = "1" ]; then
  install_experimental_vision
else
  echo "== skipping experimental Face Agent and ESP32-P4 camera provisioning =="
  echo "Set ODESK_INSTALL_EXPERIMENTAL_VISION=1 to install the optional vision integration."
fi

echo "== installing node modules (downloads linux-arm64 Electron) =="
$SUDO chown -R "${TARGET_UID}:${TARGET_GID}" "${DIR}"
if [ -x "${COREPACK_PNPM}" ]; then
  run_as_target_user pnpm install --frozen-lockfile
else
  run_as_target_user npm install
fi
run_as_target_user "${DIR}/node_modules/.bin/unocss" "src/renderer/**/*.html" "src/renderer/**/*.js" \
  -c uno.config.mjs -o src/renderer/uno.css --minify
SANDBOX_FLAG=""
if [ "$(id -u)" = "0" ]; then
  SANDBOX_FLAG="--no-sandbox"
fi
echo "electron $(run_as_target_user "${DIR}/node_modules/.bin/electron" --version $SANDBOX_FLAG 2>/dev/null || echo '?') on $(uname -m)"

if [ -d "${REMOTE_BRIDGE_SOURCE}" ]; then
  echo "== installing Remote Bridge user service =="
  BRIDGE_UNIT_DIR="${TARGET_HOME}/.config/systemd/user"
  run_as_target_user mkdir -p "$BRIDGE_UNIT_DIR"
  sed "s|__OPEN_DESKOS_REMOTE_BRIDGE_DIR__|${REMOTE_BRIDGE_SOURCE}|g" \
    "${REMOTE_BRIDGE_SOURCE}/systemd/open-deskos-remote-bridge.service" \
    > "$BRIDGE_UNIT_DIR/open-deskos-remote-bridge.service"
  chown "${TARGET_UID}:${TARGET_GID}" "$BRIDGE_UNIT_DIR/open-deskos-remote-bridge.service"
  chmod 0644 "$BRIDGE_UNIT_DIR/open-deskos-remote-bridge.service"
  if ! run_as_target_user systemctl --user daemon-reload \
    || ! run_as_target_user systemctl --user enable --now open-deskos-remote-bridge.service; then
    echo "Remote Bridge user service could not be activated for ${TARGET_USER}; verify the graphical user session and retry:" >&2
    echo "  systemctl --user enable --now open-deskos-remote-bridge.service" >&2
  fi
fi

echo "== configuring borderless Openbox kiosk window manager =="
$SUDO mkdir -p /usr/share/themes/OpenDeskOS/openbox-3
$SUDO tee /usr/share/themes/OpenDeskOS/openbox-3/themerc >/dev/null <<'EOF'
border.width: 0
padding.width: 0
padding.height: 0
window.client.padding.width: 0
window.client.padding.height: 0
window.active.border.color: #000000
window.inactive.border.color: #000000
window.active.title.bg: flat solid
window.active.title.bg.color: #000000
window.inactive.title.bg: flat solid
window.inactive.title.bg.color: #000000
window.active.handle.bg: flat solid
window.active.handle.bg.color: #000000
window.inactive.handle.bg: flat solid
window.inactive.handle.bg.color: #000000
menu.border.width: 0
EOF

OPENBOX_CONFIG_DIR="${TARGET_HOME}/.config/openbox"
run_as_target_user mkdir -p "$OPENBOX_CONFIG_DIR"
chown -R "${TARGET_UID}:${TARGET_GID}" "$OPENBOX_CONFIG_DIR"
if [ -f "$OPENBOX_CONFIG_DIR/rc.xml" ]; then
  run_as_target_user sed -i 's/<name>.*<\/name>/<name>OpenDeskOS<\/name>/' "$OPENBOX_CONFIG_DIR/rc.xml"
  run_as_target_user sed -i 's/<keepBorder>yes<\/keepBorder>/<keepBorder>no<\/keepBorder>/g' "$OPENBOX_CONFIG_DIR/rc.xml"
fi

echo "== establishing the initial immutable Open DeskOS release =="
RUNTIME_ROOT="${ODK_RUNTIME_ROOT:-/opt/open-deskos}"
RELEASES_DIR="${RUNTIME_ROOT}/releases"
RELEASE_ID="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
RELEASE_DIR="${RELEASES_DIR}/${RELEASE_ID}"
$SUDO install -d -o "${TARGET_UID}" -g "${TARGET_GID}" -m 0755 "${RELEASE_DIR}"
if [ "$(CDPATH= cd -- "${DIR}" >/dev/null && pwd -P)" != "$(CDPATH= cd -- "${RELEASE_DIR}" >/dev/null && pwd -P)" ]; then
  run_as_target_user cp -a "${DIR}/." "${RELEASE_DIR}/"
fi
run_as_target_user node -e "require('node:fs').writeFileSync('${RELEASE_DIR}/release.json', JSON.stringify({ id: '${RELEASE_ID}', schemaVersion: 1, createdAt: new Date().toISOString() }) + '\\n')"
$SUDO install -d -o "${TARGET_UID}" -g "${TARGET_GID}" -m 0755 "${RUNTIME_ROOT}/state/migrations/${TARGET_USER}"

KIOSK_UNIT_DIR="${TARGET_HOME}/.config/systemd/user"
run_as_target_user mkdir -p "$KIOSK_UNIT_DIR"
cat > "$KIOSK_UNIT_DIR/open-deskos-shell.service" <<EOF
[Unit]
Description=Open DeskOS kiosk shell
After=graphical-session.target
PartOf=graphical-session.target

[Service]
Type=simple
ExecStart=${RUNTIME_ROOT}/current/scripts/start-kiosk.sh
Restart=always
RestartSec=3
EOF
chown "${TARGET_UID}:${TARGET_GID}" "$KIOSK_UNIT_DIR/open-deskos-shell.service"
chmod 0644 "$KIOSK_UNIT_DIR/open-deskos-shell.service"
run_as_target_user systemctl --user daemon-reload
GRAPHICAL_DISPLAY="$(loginctl show-session "$(loginctl list-sessions --no-legend | awk -v user="${TARGET_USER}" '$3 == user && $2 >= 1000 { print $1; exit }')" -p Display --value 2>/dev/null || true)"
if [ -n "${GRAPHICAL_DISPLAY}" ]; then
  run_as_target_user env DISPLAY="${GRAPHICAL_DISPLAY}" systemctl --user import-environment DISPLAY
fi

if [ -d "${RUNTIME_ROOT}/current" ]; then
  $SUDO env \
    ODK_RUNTIME_ROOT="${RUNTIME_ROOT}" \
    ODK_CANDIDATE_RELEASE="${RELEASE_DIR}" \
    ODK_KIOSK_USER="${TARGET_USER}" \
    ODK_KIOSK_UID="${TARGET_UID}" \
    ODK_KIOSK_HOME="${TARGET_HOME}" \
    ODK_KIOSK_NODE_BIN="${NODE_BIN}" \
    ODK_KIOSK_BIN_DIR="${KIOSK_BIN}" \
    node "${DIR}/scripts/update-runtime.js"
else
  if [ -x "${COREPACK_PNPM}" ]; then
    (cd "${RELEASE_DIR}" && run_as_target_user pnpm preflight)
  else
    (cd "${RELEASE_DIR}" && run_as_target_user npm run preflight)
  fi
  $SUDO node "${RELEASE_DIR}/scripts/validate-release.js" "${RELEASE_DIR}"
  $SUDO chown -R root:root "${RELEASE_DIR}"
  $SUDO chmod -R a-w "${RELEASE_DIR}"
  $SUDO ln -sfn "${RELEASE_DIR}" "${RUNTIME_ROOT}/current"
fi
run_as_target_user env ODK_RUNTIME_ROOT="${RUNTIME_ROOT}" ODK_KIOSK_USER="${TARGET_USER}" \
  node "${RUNTIME_ROOT}/current/scripts/migrate-runtime.js"

AUTOSTART_DIR="${TARGET_HOME}/.config/autostart"
run_as_target_user mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/open-deskos-shell.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Open DeskOS Shell
Exec=sh -lc "systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XAUTHORITY; systemctl --user restart open-deskos-shell.service"
X-GNOME-Autostart-enabled=true
Terminal=false
EOF
chown "${TARGET_UID}:${TARGET_GID}" "$AUTOSTART_DIR/open-deskos-shell.desktop"
chmod 0644 "$AUTOSTART_DIR/open-deskos-shell.desktop"

echo "done. the graphical-session autostart activates the kiosk service resolving ${RUNTIME_ROOT}/current."
echo "logs: ~/.local/state/open-deskos-shell/launcher.log"
echo "override resolution with ODESK_SHELL_WIDTH / ODESK_SHELL_HEIGHT in the environment."
