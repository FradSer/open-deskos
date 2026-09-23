#!/usr/bin/env bash
# Run ON the CM5 as root. Idempotently provisions the device-local STT bridge:
# a statically linked whisper.cpp server plus model under /opt/stt-bridge,
# exposed ONLY on 127.0.0.1 as the kiosk user's service.
# Verifies the loopback bind and a real transcription before finishing.
set -euo pipefail

BRIDGE_DIR="/opt/stt-bridge"
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
SAMPLE_WAV="${STT_SAMPLE_WAV:-/opt/qwen3-asr-1.7b/tests/test_zh.wav}"
# The same single declaration the unit and the voice agent read: this script only mirrors the
# default so that provisioning, the service and the agent cannot disagree about one port.
STT_PORT="${ODK_STT_PORT:-17840}"
if ! [[ "${STT_PORT}" =~ ^[0-9]{1,5}$ ]]; then
  echo "ODK_STT_PORT must be a port number; got '${STT_PORT}'." >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: provisioning writes ${BRIDGE_DIR} and installs services." >&2
  exit 1
fi

TARGET_USER="${SUDO_USER:-}"
if [ -z "${TARGET_USER}" ]; then
  TARGET_USER="$(loginctl list-sessions --no-legend 2>/dev/null | awk '$2 >= 1000 { print $3; exit }')"
fi
if [ -z "${TARGET_USER}" ]; then
  TARGET_USER="$(getent passwd 1000 | cut -d: -f1)"
fi
if [ -z "${TARGET_USER}" ] || ! id "${TARGET_USER}" >/dev/null 2>&1; then
  echo "Could not determine the kiosk user." >&2
  exit 1
fi
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
TARGET_UID="$(id -u "${TARGET_USER}")"

run_as_target_user() {
  runuser -u "${TARGET_USER}" -- env HOME="${TARGET_HOME}" USER="${TARGET_USER}" \
    LOGNAME="${TARGET_USER}" XDG_RUNTIME_DIR="/run/user/${TARGET_UID}" "$@"
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." >/dev/null && pwd -P)"

if [ ! -x "${BRIDGE_DIR}/whisper-server" ]; then
  echo "== building static whisper-server =="
  apt-get install -y cmake g++ make git curl
  WORK="$(mktemp -d)"
  git clone --depth 1 --branch v1.8.2 https://github.com/ggml-org/whisper.cpp.git "${WORK}/whisper.cpp"
  cmake -S "${WORK}/whisper.cpp" -B "${WORK}/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF
  cmake --build "${WORK}/build" -j"$(nproc)" --target whisper-server
  install -d -o "${TARGET_USER}" -g "${TARGET_USER}" -m 0755 "${BRIDGE_DIR}"
  install -o "${TARGET_USER}" -g "${TARGET_USER}" -m 0755 \
    "${WORK}/build/bin/whisper-server" "${BRIDGE_DIR}/whisper-server"
  rm -rf "${WORK}"
else
  echo "== whisper-server already present, skipping build =="
fi

if [ ! -f "${BRIDGE_DIR}/ggml-base.bin" ]; then
  echo "== downloading transcription model =="
  curl -sSL -o "${BRIDGE_DIR}/ggml-base.bin" "${MODEL_URL}"
  chown "${TARGET_USER}:${TARGET_USER}" "${BRIDGE_DIR}/ggml-base.bin"
else
  echo "== transcription model already present, skipping download =="
fi

echo "== installing user service =="
UNIT_DIR="${TARGET_HOME}/.config/systemd/user"
run_as_target_user mkdir -p "${UNIT_DIR}"
install -o "${TARGET_USER}" -g "${TARGET_USER}" -m 0644 \
  "${SCRIPT_DIR}/systemd/open-deskos-stt-bridge.service" \
  "${UNIT_DIR}/open-deskos-stt-bridge.service"
run_as_target_user systemctl --user daemon-reload
run_as_target_user systemctl --user enable --now open-deskos-stt-bridge.service

echo "== verifying loopback-only bind and transcription =="
for _ in $(seq 1 30); do
  if run_as_target_user curl -s -m 5 "http://127.0.0.1:${STT_PORT}/health" | grep -q '"ok"'; then
    break
  fi
  sleep 2
done
run_as_target_user curl -s -m 5 "http://127.0.0.1:${STT_PORT}/health" | grep -q '"ok"' \
  || { echo "Bridge health check failed." >&2; exit 1; }
if ss -tln | grep -q ":${STT_PORT}\b"; then
  ss -tln | grep ":${STT_PORT}\b" | grep -vq "127.0.0.1:${STT_PORT}" \
    && { echo "Bridge is not loopback-only; refusing." >&2; exit 1; }
fi
if [ -f "${SAMPLE_WAV}" ]; then
  TEXT="$(run_as_target_user curl -s -m 120 -X POST "http://127.0.0.1:${STT_PORT}/inference" \
    -F "file=@${SAMPLE_WAV};type=audio/wav" -F language=zh -F response_format=json)"
  echo "sample transcript: ${TEXT}" | head -c 300
  echo
  echo "${TEXT}" | grep -q '"text"' || { echo "Transcription contract failed." >&2; exit 1; }
fi
echo "done. the bridge listens on 127.0.0.1:${STT_PORT}; set ODK_STT_PORT in runtime.env only to change it, and the voice agent follows that value."
