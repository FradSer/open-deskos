#!/usr/bin/env bash
# Run from a development checkout. Stages the current runtime tree on CM5,
# then lets the device-owned installer build or update its immutable release.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." >/dev/null && pwd -P)"
TARGET="${ODK_CM5_TARGET:-cm5}"
REMOTE_ROOT="${ODK_RUNTIME_ROOT:-/opt/open-deskos}"

ssh "${TARGET}" "mkdir -p '${REMOTE_ROOT}/staging' '${REMOTE_ROOT}/releases' '${REMOTE_ROOT}/state'"

rsync -a --delete --exclude node_modules --exclude .DS_Store \
  "${ROOT}/runtime/linux/" "${TARGET}:${REMOTE_ROOT}/staging/runtime-linux/"
rsync -a --delete --exclude .DS_Store \
  "${ROOT}/integrations/" "${TARGET}:${REMOTE_ROOT}/integrations/"
rsync -a --delete --exclude .DS_Store \
  "${ROOT}/experiments/" "${TARGET}:${REMOTE_ROOT}/experiments/"
rsync -a --delete --exclude .DS_Store \
  "${ROOT}/peripherals/" "${TARGET}:${REMOTE_ROOT}/peripherals/"
rsync -a "${ROOT}/DESIGN.md" "${TARGET}:${REMOTE_ROOT}/DESIGN.md"
ssh "${TARGET}" "cd '${REMOTE_ROOT}/staging/runtime-linux' && bash scripts/cm5-install.sh"
