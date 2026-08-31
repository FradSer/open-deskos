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

run_as_target_user() {
  if [ "$(id -u)" -eq "${TARGET_UID}" ]; then
    "$@"
  else
    runuser -u "${TARGET_USER}" -- env \
      XDG_RUNTIME_DIR="/run/user/${TARGET_UID}" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${TARGET_UID}/bus" \
      "$@"
  fi
}

install_face_agent() {
  if [ ! -f "${FACE_AGENT_DIR}/face_service.py" ]; then
    echo "Face Agent source is missing at ${FACE_AGENT_DIR}; install it before running this installer." >&2
    return 1
  fi
  if [ ! -f "${FACE_AGENT_DIR}/models/emotion-ferplus-8.onnx" ] \
    || [ ! -f "${FACE_AGENT_DIR}/models/face_detection_yunet_2023mar.onnx" ] \
    || [ ! -f "${FACE_AGENT_DIR}/models/face_recognition_sface_2021dec.onnx" ]; then
    echo "Face Agent model files are incomplete under ${FACE_AGENT_DIR}/models." >&2
    return 1
  fi

  echo "== provisioning Face Agent =="
  $SUDO apt-get install -y python3-venv python3-opencv python3-aiohttp python3-numpy python3-serial
  if [ ! -x "${FACE_AGENT_VENV}/bin/python3" ]; then
    $SUDO python3 -m venv --system-site-packages "${FACE_AGENT_VENV}"
  fi
  $SUDO "${FACE_AGENT_VENV}/bin/pip" install --upgrade pyserial onnxruntime opencv-contrib-python-headless
  # The provisioned Face Agent owns models, profiles, and face_engine.py.
  # This shell overlay updates only the production service implementation.
  $SUDO install -o root -g root -m 0644 face-agent/face_service.py "${FACE_AGENT_DIR}/face_service.py"
  $SUDO chown -R "${TARGET_UID}:${TARGET_GID}" "${FACE_AGENT_DIR}/data"

  run_as_target_user mkdir -p "${FACE_AGENT_UNIT_DIR}"
  run_as_target_user install -m 0644 face-agent/systemd/open-deskos-face-agent.service \
    "${FACE_AGENT_UNIT_DIR}/open-deskos-face-agent.service"
  run_as_target_user systemctl --user daemon-reload
  run_as_target_user systemctl --user enable --now open-deskos-face-agent.service
}

install_face_agent

echo "== configuring the ESP32-P4 camera serial link =="
# The P4 board's USB-UART bridge presents its console/metadata link as 1a86:55d3.
$SUDO tee /etc/udev/rules.d/99-open-deskos-p4-camera.rules >/dev/null <<'EOF'
SUBSYSTEM=="tty", KERNEL=="ttyACM*", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d3", SYMLINK+="open-deskos-p4-camera", GROUP="dialout", MODE="0660"
EOF
$SUDO udevadm control --reload-rules
$SUDO udevadm trigger --subsystem-match=tty

if [ ! -e /dev/open-deskos-p4-camera ]; then
  echo "ESP32-P4 camera serial adapter not detected yet; connect it and rerun udevadm trigger before starting the Face Agent." >&2
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

if [ -d remote-bridge ]; then
  echo "== installing Remote Bridge user service =="
  BRIDGE_UNIT_DIR="${HOME}/.config/systemd/user"
  mkdir -p "$BRIDGE_UNIT_DIR"
  sed "s|__OPEN_DESKOS_SHELL_DIR__|${DIR}|g" \
    remote-bridge/systemd/open-deskos-remote-bridge.service \
    > "$BRIDGE_UNIT_DIR/open-deskos-remote-bridge.service"
  chmod 0644 "$BRIDGE_UNIT_DIR/open-deskos-remote-bridge.service"
  if ! systemctl --user daemon-reload || ! systemctl --user enable --now open-deskos-remote-bridge.service; then
    echo "Remote Bridge user service could not be activated; verify the graphical user session and retry:" >&2
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
mkdir -p "$OPENBOX_CONFIG_DIR"
if [ -f "$OPENBOX_CONFIG_DIR/rc.xml" ]; then
  sed -i 's/<name>.*<\/name>/<name>OpenDeskOS<\/name>/' "$OPENBOX_CONFIG_DIR/rc.xml"
  sed -i 's/<keepBorder>yes<\/keepBorder>/<keepBorder>no<\/keepBorder>/g' "$OPENBOX_CONFIG_DIR/rc.xml"
fi

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
